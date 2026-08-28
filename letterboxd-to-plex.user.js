// ==UserScript==
// @name         PlexHop (Letterboxd to Plex)
// @namespace    https://letterboxd.com/
// @version      1.4.0
// @description  Adds direct links to your Plex Server (if in library) or Plex Discover on Letterboxd film pages with configurable display locations.
// @author       Matt Coady
// @match        https://letterboxd.com/film/*
// @match        https://app.plex.tv/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      plex.tv
// @connect      discover.provider.plex.tv
// @connect      *
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // If on app.plex.tv, auto-sync token
  if (window.location.hostname === 'app.plex.tv') {
    try {
      const token = localStorage.getItem('myPlexAccessToken');
      if (token) {
        GM_setValue('plexToken', token);
        console.log('[PlexHop] Plex token auto-captured from app.plex.tv!');
      }
    } catch (e) {
      console.warn('[PlexHop] Auto-sync error:', e);
    }
    return;
  }

  // --- Below this runs on Letterboxd ---

  const STYLES = `
    .service.-plex .brand {
      background-color: #1f2326 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 3px !important;
      position: relative;
    }
    .service.-plex .brand svg {
      width: 20px;
      height: 20px;
      fill: #e5a00d;
    }
    .service.-plex:hover .brand {
      background-color: #2b3035 !important;
      box-shadow: 0 0 6px rgba(229, 160, 13, 0.4);
    }
    .service.-plex.on-server .brand {
      box-shadow: inset 0 0 0 1.5px #00e054;
    }
    .service.-plex.on-server:hover .brand {
      box-shadow: 0 0 8px rgba(0, 224, 84, 0.5), inset 0 0 0 1.5px #00e054;
    }
    .plex-sidebar-action {
      margin: 10px 0;
    }
    .plex-sidebar-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      padding: 8px 12px;
      background: linear-gradient(135deg, #1f252b 0%, #151a1e 100%);
      border: 1px solid #303840;
      border-radius: 4px;
      color: #cdd;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none !important;
      transition: all 0.2s ease-in-out;
      cursor: pointer;
    }
    .plex-sidebar-btn:hover {
      background: linear-gradient(135deg, #2b333c 0%, #1f262d 100%);
      border-color: #e5a00d;
      color: #fff;
      box-shadow: 0 2px 8px rgba(229, 160, 13, 0.25);
    }
    .plex-sidebar-btn.on-server {
      border-color: rgba(0, 224, 84, 0.4);
    }
    .plex-sidebar-btn.on-server:hover {
      border-color: #00e054;
      box-shadow: 0 2px 8px rgba(0, 224, 84, 0.3);
    }
    .plex-sidebar-btn svg {
      width: 16px;
      height: 16px;
      fill: #e5a00d;
      flex-shrink: 0;
    }
    .plex-sidebar-btn .plex-badge-mode {
      margin-left: auto;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 5px;
      background: rgba(229, 160, 13, 0.15);
      color: #e5a00d;
      border-radius: 3px;
    }
    .plex-sidebar-btn .plex-badge-mode.server {
      background: rgba(0, 224, 84, 0.15);
      color: #00e054;
    }
    .plex-sidebar-btn .plex-badge-mode.discover {
      background: rgba(229, 160, 13, 0.15);
      color: #e5a00d;
    }
    .plex-sidebar-btn .plex-badge-mode.search {
      background: rgba(100, 120, 140, 0.2);
      color: #89a;
    }
    .plex-meta-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
      padding: 2px 6px;
      background: #1c2127;
      border: 1px solid #2d353f;
      border-radius: 3px;
      color: #9ab;
      font-size: 12px;
      font-weight: 500;
      text-decoration: none !important;
      vertical-align: middle;
      transition: all 0.2s;
    }
    .plex-meta-link:hover {
      color: #fff;
      border-color: #e5a00d;
      background: #252c34;
    }
    .plex-meta-link.on-server {
      border-color: rgba(0, 224, 84, 0.5);
      color: #00e054;
    }
    .plex-meta-link svg {
      width: 12px;
      height: 12px;
      fill: #e5a00d;
    }
  `;

  if (typeof GM_addStyle !== 'undefined') {
    GM_addStyle(STYLES);
  } else {
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
  }

  const PLEX_CHEVRON_SVG = `
    <svg viewBox="0 0 24 24" width="16" height="16" style="display:inline-block;vertical-align:middle;">
      <path fill="#E5A00D" d="M3.5 2.5h6l8.5 9.5-8.5 9.5h-6l8.5-9.5L3.5 2.5z"/>
    </svg>
  `;

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

  function getClientId() {
    let clientId = (typeof GM_getValue !== 'undefined' ? GM_getValue('plexClientId', '') : '') ||
                   localStorage.getItem('lb_plex_client_id');
    if (!clientId) {
      clientId = 'lb-plex-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15));
      if (typeof GM_setValue !== 'undefined') GM_setValue('plexClientId', clientId);
      localStorage.setItem('lb_plex_client_id', clientId);
    }
    return clientId;
  }

  function getPlexHeaders(token) {
    return {
      'Accept': 'application/json',
      'X-Plex-Token': token,
      'X-Plex-Client-Identifier': getClientId(),
      'X-Plex-Product': 'PlexHop',
      'X-Plex-Version': '1.4.0',
      'X-Plex-Platform': 'Browser',
      'X-Plex-Device': 'Desktop',
      'X-Plex-Device-Name': 'PlexHop'
    };
  }

  function getOption(key, defaultValue = true) {
    if (typeof GM_getValue !== 'undefined') {
      const val = GM_getValue(key, defaultValue);
      return val !== false;
    }
    const local = localStorage.getItem(`lb_plex_${key}`);
    return local !== null ? local !== 'false' : defaultValue;
  }

  function setOption(key, value) {
    if (typeof GM_setValue !== 'undefined') GM_setValue(key, value);
    localStorage.setItem(`lb_plex_${key}`, value);
  }

  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('⚙️ Configure Plex Token', () => {
      const currentToken = GM_getValue('plexToken', '');
      const token = prompt('Enter your X-Plex-Token:', currentToken);
      if (token !== null) {
        GM_setValue('plexToken', token.trim());
        alert(token.trim() ? 'Plex Token saved!' : 'Plex Token cleared.');
        location.reload();
      }
    });

    GM_registerMenuCommand('🔘 Toggle Sidebar Button', () => {
      const current = getOption('showSidebar', true);
      setOption('showSidebar', !current);
      alert(`Sidebar button is now ${!current ? 'ENABLED' : 'DISABLED'}`);
      location.reload();
    });

    GM_registerMenuCommand('🔘 Toggle Where to Watch Badge', () => {
      const current = getOption('showWatch', true);
      setOption('showWatch', !current);
      alert(`Where to Watch badge is now ${!current ? 'ENABLED' : 'DISABLED'}`);
      location.reload();
    });

    GM_registerMenuCommand('🔘 Toggle Details Link', () => {
      const current = getOption('showDetails', true);
      setOption('showDetails', !current);
      alert(`Details metadata link is now ${!current ? 'ENABLED' : 'DISABLED'}`);
      location.reload();
    });

    GM_registerMenuCommand('🗑️ Clear Cached Film Mappings', () => {
      let count = 0;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('lb_plex_key_') || key.startsWith('lb_plex_target_'))) {
          localStorage.removeItem(key);
          count++;
        }
      }
      alert(`Cleared ${count} cached film mappings.`);
    });
  }

  let currentPath = '';
  let isResolving = false;
  let cachedServers = null;
  let cachedServersTime = 0;

  function getToken() {
    return (typeof GM_getValue !== 'undefined' ? GM_getValue('plexToken', '') : '') ||
           localStorage.getItem('lb_plex_token') || '';
  }

  function getCachedResult(slug) {
    try {
      const cached = localStorage.getItem(`lb_plex_target_${slug}`);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < 7 * 24 * 60 * 60 * 1000) {
          return data;
        }
      }
    } catch (e) {
      console.warn('[PlexHop] Cache read error:', e);
    }
    return null;
  }

  function setCachedResult(slug, result) {
    try {
      localStorage.setItem(`lb_plex_target_${slug}`, JSON.stringify({
        ...result,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn('[PlexHop] Cache write error:', e);
    }
  }

  function extractMovieInfo() {
    const pathname = window.location.pathname;
    if (!pathname.startsWith('/film/')) return null;

    const parts = pathname.split('/').filter(Boolean);
    const slug = parts[1] || '';
    if (!slug) return null;

    let title = '';
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const headline = document.querySelector('h1.headline-1')?.innerText ||
                     document.querySelector('section#featured-film-header h1')?.innerText ||
                     document.querySelector('.film-header-group h1')?.innerText || '';
    
    title = sanitizeText(headline || ogTitle).replace(/\s*\(\d{4}\)\s*$/, '').trim();

    let year = '';
    const yearEl = document.querySelector('.releaseyear a') || document.querySelector('.releaseyear');
    if (yearEl) {
      year = sanitizeText(yearEl.innerText);
    } else {
      const yearMatch = (ogTitle || document.title).match(/\((\d{4})\)/);
      if (yearMatch) year = yearMatch[1];
    }

    let imdbId = '';
    const imdbLink = document.querySelector('a[href*="imdb.com/title/"]');
    if (imdbLink) {
      const match = imdbLink.href.match(/(tt\d+)/);
      if (match) imdbId = match[1];
    }

    return { title, year, imdbId, slug };
  }

  function getSearchUrl(title, year) {
    const cleanTitle = sanitizeText(title);
    const cleanYear = sanitizeText(year);
    const q = cleanYear ? `${cleanTitle} ${cleanYear}` : cleanTitle;
    return `https://app.plex.tv/desktop/#!/search?query=${encodeURIComponent(q)}`;
  }

  function getDiscoverUrl(ratingKey) {
    return `https://app.plex.tv/desktop/#!/provider/tv.plex.provider.discover/details?key=%2Flibrary%2Fmetadata%2F${encodeURIComponent(ratingKey)}`;
  }

  function getServerUrl(machineIdentifier, ratingKey) {
    return `https://app.plex.tv/desktop/#!/server/${machineIdentifier}/details?key=%2Flibrary%2Fmetadata%2F${encodeURIComponent(ratingKey)}`;
  }

  function makeRequest(url, headers) {
    return new Promise((resolve) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          headers: headers,
          timeout: 4000,
          onload: (res) => {
            if (res.status === 200) {
              try { resolve(JSON.parse(res.responseText)); }
              catch(e) { resolve(null); }
            } else { resolve(null); }
          },
          ontimeout: () => resolve(null),
          onerror: () => resolve(null)
        });
      } else {
        fetch(url, { headers })
          .then(r => r.ok ? r.json() : null)
          .then(resolve)
          .catch(() => resolve(null));
      }
    });
  }

  async function getUserServers(token) {
    if (cachedServers && (Date.now() - cachedServersTime < 3600000)) {
      return cachedServers;
    }
    const data = await makeRequest('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', getPlexHeaders(token));
    if (Array.isArray(data)) {
      cachedServers = data.filter(d => d.provides && d.provides.includes('server') && Array.isArray(d.connections));
      cachedServersTime = Date.now();
      return cachedServers;
    }
    return [];
  }

  async function searchUserServers(title, year, token, imdbId) {
    const servers = await getUserServers(token);
    if (!servers || servers.length === 0) return null;

    const cleanTitle = sanitizeText(title);
    const normTargetTitle = normalize(cleanTitle);
    const targetYear = parseInt(year, 10);

    for (const server of servers) {
      const serverToken = server.accessToken || token;
      const connections = [...server.connections].sort((a, b) => {
        if (a.local && !b.local) return -1;
        if (!a.local && b.local) return 1;
        if (a.protocol === 'https' && b.protocol !== 'https') return -1;
        return 0;
      });

      for (const conn of connections) {
        if (!conn.uri) continue;
        const searchUrl = `${conn.uri}/hubs/search?query=${encodeURIComponent(cleanTitle)}&limit=10`;
        const data = await makeRequest(searchUrl, { 'Accept': 'application/json', 'X-Plex-Token': serverToken });
        if (!data) continue;

        const items = [];
        if (Array.isArray(data.MediaContainer?.Metadata)) items.push(...data.MediaContainer.Metadata);
        if (Array.isArray(data.MediaContainer?.Hub)) {
          for (const hub of data.MediaContainer.Hub) {
            if (hub.type === 'movie' && Array.isArray(hub.Metadata)) items.push(...hub.Metadata);
          }
        }

        for (const item of items) {
          if (item.type !== 'movie') continue;
          const itemTitleNorm = normalize(item.title || '');
          const itemYear = parseInt(item.year, 10);

          const imdbMatch = imdbId && (
            (item.guid && item.guid.includes(imdbId)) ||
            (Array.isArray(item.Guid) && item.Guid.some(g => g.id && g.id.includes(imdbId)))
          );

          const titleMatch = (itemTitleNorm === normTargetTitle) &&
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
      }
    }
    return null;
  }

  async function fetchPlexDiscoverRatingKey(title, year, token, imdbId) {
    const cleanTitle = sanitizeText(title);
    const normTargetTitle = normalize(cleanTitle);
    const targetYear = parseInt(year, 10);
    const headers = getPlexHeaders(token);

    const urls = [
      `https://discover.provider.plex.tv/library/metadata/matches?manual=1&title=${encodeURIComponent(cleanTitle)}&year=${encodeURIComponent(year || '')}&type=1`,
      `https://discover.provider.plex.tv/library/search?query=${encodeURIComponent(cleanTitle)}&limit=10`
    ];

    for (const url of urls) {
      const data = await makeRequest(url, headers);
      if (!data) continue;

      const items = [];
      if (Array.isArray(data.MediaContainer?.Metadata)) items.push(...data.MediaContainer.Metadata);
      if (Array.isArray(data.MediaContainer?.SearchResult)) items.push(...data.MediaContainer.SearchResult);

      if (items.length === 0) continue;

      if (imdbId) {
        for (const item of items) {
          if (item.guid && item.guid.includes(imdbId)) return item.ratingKey || item.id;
          if (Array.isArray(item.Guid) && item.Guid.some(g => g.id && g.id.includes(imdbId))) return item.ratingKey || item.id;
        }
      }

      for (const item of items) {
        const itemTitleNorm = normalize(item.title || '');
        const itemYear = parseInt(item.year, 10);
        if (itemTitleNorm === normTargetTitle) {
          if (!targetYear || !itemYear || Math.abs(itemYear - targetYear) <= 1) return item.ratingKey || item.id;
        }
      }

      if (items[0] && (items[0].ratingKey || items[0].id)) return items[0].ratingKey || items[0].id;
    }
    return null;
  }

  async function resolveTargetUrl(movie, token) {
    if (token) {
      const serverMatch = await searchUserServers(movie.title, movie.year, token, movie.imdbId);
      if (serverMatch) return serverMatch;

      const discoverKey = await fetchPlexDiscoverRatingKey(movie.title, movie.year, token, movie.imdbId);
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

  async function injectPlexLinks() {
    const movie = extractMovieInfo();
    if (!movie || !movie.title) return;

    const token = getToken();
    const showSidebar = getOption('showSidebar', true);
    const showWatch = getOption('showWatch', true);
    const showDetails = getOption('showDetails', true);

    let activeType = 'search';
    let activeUrl = getSearchUrl(movie.title, movie.year);

    const cached = getCachedResult(movie.slug);
    if (cached && cached.url) {
      activeUrl = cached.url;
      activeType = cached.type || 'discover';
    }

    // 1. Sidebar Button
    if (showSidebar) {
      injectSidebarButton(activeUrl, activeType);
    } else {
      document.getElementById('plex-sidebar-action-container')?.remove();
    }

    // 2. Where to Watch Badge
    if (showWatch) {
      injectWatchPanelBadge(activeUrl, activeType);
    } else {
      document.getElementById('service-plex-discover')?.remove();
    }

    // 3. Details Metadata Link
    if (showDetails) {
      injectHeaderMetadataLink(activeUrl, activeType);
    } else {
      document.getElementById('plex-header-meta-link')?.remove();
    }

    if (!cached && token && !isResolving) {
      isResolving = true;
      try {
        const resolved = await resolveTargetUrl(movie, token);
        if (resolved && resolved.url) {
          setCachedResult(movie.slug, resolved);
          updateAllInjectedLinks(resolved.url, resolved.type, resolved.serverName);
        }
      } finally {
        isResolving = false;
      }
    }
  }

  function updateAllInjectedLinks(url, type, serverName) {
    document.querySelectorAll('.lb-plex-link').forEach((el) => {
      el.href = url;
      if (type === 'server') {
        el.classList.add('on-server');
        if (serverName) el.title = `Watch on Plex Server (${serverName})`;
      } else {
        el.classList.remove('on-server');
      }
    });

    document.querySelectorAll('.plex-badge-mode').forEach((el) => {
      el.className = `plex-badge-mode ${type}`;
      if (type === 'server') {
        el.textContent = 'On Server';
      } else if (type === 'discover') {
        el.textContent = 'Discover';
      } else {
        el.textContent = 'Search';
      }
    });

    const watchBadge = document.getElementById('service-plex-discover');
    if (watchBadge) {
      if (type === 'server') watchBadge.classList.add('on-server');
      else watchBadge.classList.remove('on-server');
    }
  }

  function injectSidebarButton(url, type) {
    if (document.getElementById('plex-sidebar-action-container')) return;

    const targetContainer = document.querySelector('ul.film-stats') ||
                            document.querySelector('.actions-panel') ||
                            document.querySelector('aside.sidebar .sidebar-content');
    if (!targetContainer) return;

    const isServer = type === 'server';
    const badgeLabel = isServer ? 'On Server' : (type === 'discover' ? 'Discover' : 'Search');

    const actionWrapper = document.createElement('div');
    actionWrapper.id = 'plex-sidebar-action-container';
    actionWrapper.className = 'plex-sidebar-action';
    actionWrapper.innerHTML = `
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="plex-sidebar-btn lb-plex-link ${isServer ? 'on-server' : ''}" title="Open in Plex">
        ${PLEX_CHEVRON_SVG}
        <span>Open in Plex</span>
        <span class="plex-badge-mode ${type}">${badgeLabel}</span>
      </a>
    `;

    if (targetContainer.tagName === 'UL') {
      const li = document.createElement('li');
      li.style.listStyle = 'none';
      li.style.margin = '8px 0';
      li.appendChild(actionWrapper);
      targetContainer.parentNode.insertBefore(li, targetContainer.nextSibling);
    } else {
      targetContainer.appendChild(actionWrapper);
    }
  }

  function injectWatchPanelBadge(url, type) {
    if (document.getElementById('service-plex-discover')) return;

    const servicesList = document.querySelector('section.services') ||
                         document.querySelector('.services') ||
                         document.querySelector('div.js-watch-panel .services');

    const isServer = type === 'server';

    if (servicesList) {
      const plexServiceItem = document.createElement('p');
      plexServiceItem.id = 'service-plex-discover';
      plexServiceItem.className = `service -plex ${isServer ? 'on-server' : ''}`;
      plexServiceItem.innerHTML = `
        <a href="${url}" class="label track-event tooltip lb-plex-link" target="_blank" rel="noopener noreferrer" data-original-title="View on Plex">
          <span class="brand">${PLEX_CHEVRON_SVG}</span>
          <span class="title">Plex</span>
        </a>
      `;
      servicesList.insertBefore(plexServiceItem, servicesList.firstChild);
    } else {
      const notStreamingMsg = document.querySelector('.js-not-streaming') ||
                              document.querySelector('section.watch-panel .other.-message');
      if (notStreamingMsg && notStreamingMsg.parentNode) {
        const customServices = document.createElement('section');
        customServices.className = 'services';
        customServices.innerHTML = `
          <p id="service-plex-discover" class="service -plex ${isServer ? 'on-server' : ''}">
            <a href="${url}" class="label track-event tooltip lb-plex-link" target="_blank" rel="noopener noreferrer" data-original-title="View on Plex">
              <span class="brand">${PLEX_CHEVRON_SVG}</span>
              <span class="title">Plex</span>
            </a>
          </p>
        `;
        notStreamingMsg.parentNode.insertBefore(customServices, notStreamingMsg);
      }
    }
  }

  function injectHeaderMetadataLink(url, type) {
    if (document.getElementById('plex-header-meta-link')) return;

    const externalLinksContainer = document.querySelector('a[data-track-action="IMDb"]')?.parentNode ||
                                   document.querySelector('a[data-track-action="TMDB"]')?.parentNode ||
                                   document.querySelector('.track-event[href*="imdb.com"]')?.parentNode;

    if (externalLinksContainer) {
      const isServer = type === 'server';
      const metaLink = document.createElement('a');
      metaLink.id = 'plex-header-meta-link';
      metaLink.className = `plex-meta-link lb-plex-link ${isServer ? 'on-server' : ''}`;
      metaLink.href = url;
      metaLink.target = '_blank';
      metaLink.rel = 'noopener noreferrer';
      metaLink.title = 'View on Plex';
      metaLink.innerHTML = `${PLEX_CHEVRON_SVG} Plex`;
      externalLinksContainer.appendChild(metaLink);
    }
  }

  function handleUrlChange() {
    if (window.location.pathname !== currentPath) {
      currentPath = window.location.pathname;
      document.getElementById('plex-sidebar-action-container')?.remove();
      document.getElementById('service-plex-discover')?.remove();
      document.getElementById('plex-header-meta-link')?.remove();

      if (currentPath.startsWith('/film/')) {
        setTimeout(injectPlexLinks, 200);
      }
    }
  }

  function init() {
    currentPath = window.location.pathname;
    if (currentPath.startsWith('/film/')) {
      injectPlexLinks();
    }

    const observer = new MutationObserver(() => {
      handleUrlChange();
      if (window.location.pathname.startsWith('/film/')) {
        injectPlexLinks();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', handleUrlChange);
    document.addEventListener('turbo:load', handleUrlChange);
    document.addEventListener('turbolinks:load', handleUrlChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
