// PlexHop - Background Service Worker
// All Plex API calls happen here (not in content scripts) so the extension
// only needs narrow host permissions for Plex's own domains.

const SERVER_LIST_TTL = 3600000; // 1 hour
const REQUEST_TIMEOUT = 3000;

function sanitizeText(str) {
  if (!str) return '';
  return str
    .replace(/[\u00A0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(str) {
  return sanitizeText(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function getClientId() {
  const { clientId } = await chrome.storage.local.get('clientId');
  if (clientId) return clientId;
  const newId = 'lb-plex-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15));
  await chrome.storage.local.set({ clientId: newId });
  return newId;
}

async function getPlexHeaders(token) {
  return {
    'Accept': 'application/json',
    'X-Plex-Token': token,
    'X-Plex-Client-Identifier': await getClientId(),
    'X-Plex-Product': 'PlexHop',
    'X-Plex-Version': chrome.runtime.getManifest().version,
    'X-Plex-Platform': 'Browser',
    'X-Plex-Device': 'Desktop',
    'X-Plex-Device-Name': 'PlexHop'
  };
}

function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

function getSearchUrl(title, year) {
  const q = year ? `${sanitizeText(title)} ${sanitizeText(year)}` : sanitizeText(title);
  return `https://app.plex.tv/desktop/#!/search?query=${encodeURIComponent(q)}`;
}

function getDiscoverUrl(ratingKey) {
  return `https://app.plex.tv/desktop/#!/provider/tv.plex.provider.discover/details?key=%2Flibrary%2Fmetadata%2F${encodeURIComponent(ratingKey)}`;
}

function getServerUrl(machineIdentifier, ratingKey) {
  return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(machineIdentifier)}/details?key=%2Flibrary%2Fmetadata%2F${encodeURIComponent(ratingKey)}`;
}

// 1. Fetch the user's server list from plex.tv (cached in session storage)
async function getUserServers(token) {
  try {
    const { serverCache } = await chrome.storage.session.get('serverCache');
    if (serverCache && Date.now() - serverCache.timestamp < SERVER_LIST_TTL) {
      return serverCache.servers;
    }
  } catch (e) {
    // storage.session unavailable; fall through to a live fetch
  }

  try {
    const res = await fetchWithTimeout('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
      headers: await getPlexHeaders(token)
    }, 8000);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        const servers = data.filter(d => d.provides && d.provides.includes('server') && Array.isArray(d.connections));
        try {
          await chrome.storage.session.set({ serverCache: { servers, timestamp: Date.now() } });
        } catch (e) { /* non-fatal */ }
        return servers;
      }
    }
  } catch (e) {
    console.warn('[PlexHop] Error fetching user servers:', e);
  }
  return [];
}

// 2. Search the user's personal servers for the movie or show
async function searchUserServers(title, year, token, imdbId, mediaType) {
  const servers = await getUserServers(token);
  if (!servers || servers.length === 0) return null;

  const cleanTitle = sanitizeText(title);
  const normTargetTitle = normalize(cleanTitle);
  const targetYear = parseInt(year, 10);
  // Which Plex item types are acceptable. mediaType is a soft hint ('movie'
  // | 'show' | '' unknown); IMDb-ID matches are always accepted regardless.
  const allowedTypes = mediaType === 'show' ? ['show']
    : mediaType === 'movie' ? ['movie']
    : ['movie', 'show'];

  for (const server of servers) {
    const serverToken = server.accessToken || token;
    // Only secure connections; the token travels in a header, never the URL.
    const connections = server.connections
      .filter(c => c.uri && c.protocol === 'https')
      .sort((a, b) => {
        if (a.local && !b.local) return -1;
        if (!a.local && b.local) return 1;
        if (a.relay && !b.relay) return 1;
        if (!a.relay && b.relay) return -1;
        return 0;
      });

    for (const conn of connections) {
      try {
        const searchUrl = `${conn.uri}/hubs/search?query=${encodeURIComponent(cleanTitle)}&limit=10`;
        const response = await fetchWithTimeout(searchUrl, {
          headers: {
            'Accept': 'application/json',
            'X-Plex-Token': serverToken
          }
        });

        if (!response.ok) continue;

        const data = await response.json();
        const items = [];

        if (Array.isArray(data.MediaContainer?.Metadata)) {
          items.push(...data.MediaContainer.Metadata);
        }
        if (Array.isArray(data.MediaContainer?.Hub)) {
          for (const hub of data.MediaContainer.Hub) {
            if ((hub.type === 'movie' || hub.type === 'show') && Array.isArray(hub.Metadata)) {
              items.push(...hub.Metadata);
            }
          }
        }

        for (const item of items) {
          if (item.type !== 'movie' && item.type !== 'show') continue;

          const itemTitleNorm = normalize(item.title || '');
          const itemYear = parseInt(item.year, 10);

          const imdbMatch = imdbId && (
            (item.guid && item.guid.includes(imdbId)) ||
            (Array.isArray(item.Guid) && item.Guid.some(g => g.id && g.id.includes(imdbId)))
          );

          // Title fallback must be the right kind of item (when we know it),
          // so a same-named movie can't shadow the show we're after.
          const titleMatch = allowedTypes.includes(item.type) &&
            (itemTitleNorm === normTargetTitle) &&
            (!targetYear || !itemYear || Math.abs(itemYear - targetYear) <= 1);

          if (imdbMatch || titleMatch) {
            return {
              type: 'server',
              machineIdentifier: server.clientIdentifier,
              serverName: server.name,
              ratingKey: item.ratingKey,
              url: getServerUrl(server.clientIdentifier, item.ratingKey)
            };
          }
        }

        // This connection worked but had no match; no need to try the
        // server's other connections.
        break;
      } catch (err) {
        // Connection unreachable or blocked; try the next one.
      }
    }
  }

  return null;
}

// 3. Search the Discover API for the movie or show
async function fetchPlexDiscoverRatingKey(title, year, token, imdbId, mediaType) {
  const cleanTitle = sanitizeText(title);
  const normTargetTitle = normalize(cleanTitle);
  const targetYear = parseInt(year, 10);
  const headers = await getPlexHeaders(token);

  // Plex Discover types: 1 = movie, 2 = show. When we don't know, try both.
  const matchTypes = mediaType === 'show' ? [2]
    : mediaType === 'movie' ? [1]
    : [1, 2];
  const matchUrl = (t) =>
    `https://discover.provider.plex.tv/library/metadata/matches?manual=1&title=${encodeURIComponent(cleanTitle)}&year=${encodeURIComponent(year || '')}&type=${t}`;

  const candidateUrls = [
    ...matchTypes.map(matchUrl),
    `https://discover.provider.plex.tv/library/search?query=${encodeURIComponent(cleanTitle)}&limit=10`
  ];

  for (const url of candidateUrls) {
    try {
      const response = await fetchWithTimeout(url, { headers }, 8000);
      if (!response.ok) continue;

      const data = await response.json();
      const items = [];

      if (Array.isArray(data.MediaContainer?.Metadata)) {
        items.push(...data.MediaContainer.Metadata);
      }
      if (Array.isArray(data.MediaContainer?.SearchResult)) {
        items.push(...data.MediaContainer.SearchResult);
      }

      if (items.length === 0) continue;

      if (imdbId) {
        for (const item of items) {
          if (item.guid && item.guid.includes(imdbId)) {
            return item.ratingKey || item.id;
          }
          if (Array.isArray(item.Guid) && item.Guid.some(g => g.id && g.id.includes(imdbId))) {
            return item.ratingKey || item.id;
          }
        }
      }

      for (const item of items) {
        const itemTitleNorm = normalize(item.title || '');
        const itemYear = parseInt(item.year, 10);

        if (itemTitleNorm === normTargetTitle) {
          if (!targetYear || !itemYear || Math.abs(itemYear - targetYear) <= 1) {
            return item.ratingKey || item.id;
          }
        }
      }
      // No confident match in this response; deliberately no first-item
      // fallback — a wrong deep link is worse than falling back to search.
    } catch (e) {
      console.warn('[PlexHop] Discover fetch failed:', e);
    }
  }

  return null;
}

async function resolveMovie(movie) {
  const settings = await chrome.storage.local.get(['plexToken', 'preferredMode']);
  const plexToken = settings.plexToken || '';
  const preferredMode = settings.preferredMode || 'server_first';

  if (plexToken && preferredMode !== 'discover_only' && preferredMode !== 'search_only') {
    const serverMatch = await searchUserServers(movie.title, movie.year, plexToken, movie.imdbId, movie.type);
    if (serverMatch) return serverMatch;
    if (preferredMode === 'server_only') {
      return { type: 'search', url: getSearchUrl(movie.title, movie.year) };
    }
  }

  if (plexToken && preferredMode !== 'search_only') {
    const discoverKey = await fetchPlexDiscoverRatingKey(movie.title, movie.year, plexToken, movie.imdbId, movie.type);
    if (discoverKey) {
      return {
        type: 'discover',
        ratingKey: discoverKey,
        url: getDiscoverUrl(discoverKey)
      };
    }
  }

  return {
    type: 'search',
    url: getSearchUrl(movie.title, movie.year)
  };
}

async function testToken(token) {
  const headers = await getPlexHeaders(token);

  const userRes = await fetchWithTimeout('https://plex.tv/api/v2/user', { headers }, 8000);
  if (userRes.status === 401) {
    return { ok: false, reason: 'unauthorized' };
  }

  let username = '';
  if (userRes.ok) {
    const userData = await userRes.json();
    username = userData.username || userData.email || '';
  }

  let serverNames = [];
  try {
    const resRes = await fetchWithTimeout('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { headers }, 8000);
    if (resRes.ok) {
      const resources = await resRes.json();
      if (Array.isArray(resources)) {
        serverNames = resources
          .filter(r => r.provides && r.provides.includes('server'))
          .map(s => s.name);
      }
    }
  } catch (err) {
    console.warn('[PlexHop] Resources fetch error:', err);
  }

  return { ok: true, username, serverNames };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {
        case 'resolveMovie':
          sendResponse(await resolveMovie(msg.movie));
          break;
        case 'testToken':
          sendResponse(await testToken(msg.token));
          break;
        default:
          sendResponse({ error: `Unknown action: ${msg.action}` });
      }
    } catch (e) {
      sendResponse({ error: e.message });
    }
  })();
  return true; // keep the message channel open for the async response
});
