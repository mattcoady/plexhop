// PlexHop - Content Script
//
// Adds "Open in Plex" links to movie pages. The engine at the bottom is
// site-agnostic: it picks whichever SITE_ADAPTER matches the current page,
// asks it to extract the film and inject links, and delegates all Plex API
// calls to the background service worker.
//
// To support a new site, add one object to SITE_ADAPTERS implementing the
// adapter interface (see the LETTERBOXD adapter for a fully commented
// reference). No engine changes required.
(function () {
  'use strict';

  const CACHE_PREFIX = 'cacheTarget_';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
  const INJECTED_CLASS = 'plexhop-injected'; // marks every top-level node we add
  const LINK_CLASS = 'plexhop-link';         // marks every anchor we add

  let currentUrl = '';
  let isResolving = false;
  let injectScheduled = false;
  let lastSettings = null;
  // The display state for the current film, kept across dynamic re-renders so a
  // mid-resolve "Checking…" (or the final result) survives the page mutating.
  let displayState = null; // { token, url, type, serverName }

  // ---------------------------------------------------------------------------
  // Shared helpers (used by every adapter)
  // ---------------------------------------------------------------------------

  function sanitizeText(str) {
    if (!str) return '';
    return str
      .replace(/[\u00A0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function createPlexIcon() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.style.display = 'inline-block';
    svg.style.verticalAlign = 'middle';
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill', '#E5A00D');
    path.setAttribute('d', 'M3.5 2.5h6l8.5 9.5-8.5 9.5h-6l8.5-9.5L3.5 2.5z');
    svg.appendChild(path);
    return svg;
  }

  function getSearchUrl(title, year) {
    const cleanTitle = sanitizeText(title);
    const cleanYear = sanitizeText(year);
    const q = cleanYear ? `${cleanTitle} ${cleanYear}` : cleanTitle;
    return `https://app.plex.tv/desktop/#!/search?query=${encodeURIComponent(q)}`;
  }

  function badgeLabelFor(type) {
    if (type === 'checking') return 'Checking…';
    if (type === 'server') return 'On Server';
    if (type === 'discover') return 'Discover';
    return 'Search';
  }

  function applyLinkTarget(el, settings) {
    if (settings.openInNewTab) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    } else {
      el.removeAttribute('target');
      el.removeAttribute('rel');
    }
  }

  // Build an anchor tagged with the shared marker class so the engine can find
  // and update it later (href + on-server state) once resolution completes.
  function createPlexAnchor(url, settings, type, className) {
    const a = document.createElement('a');
    a.href = url;
    a.className = `${className} ${LINK_CLASS}${type === 'server' ? ' on-server' : ''}`;
    applyLinkTarget(a, settings);
    return a;
  }

  // A full "Open in Plex" button: icon + label + mode badge. Sites pass their
  // own className for styling; the shared badge classes drive the color.
  function createPlexButton(url, settings, type, className) {
    const link = createPlexAnchor(url, settings, type, className);
    link.title = 'Open in Plex';
    link.appendChild(createPlexIcon());

    const label = document.createElement('span');
    label.className = 'plexhop-btn-label';
    label.textContent = 'Open in Plex';
    link.appendChild(label);

    const badge = document.createElement('span');
    badge.className = `plex-badge-mode ${type}`;
    badge.textContent = badgeLabelFor(type);
    link.appendChild(badge);
    return link;
  }

  function readImdbIdFromLinks() {
    const imdbLink = document.querySelector('a[href*="imdb.com/title/"]');
    if (imdbLink) {
      const match = imdbLink.href.match(/(tt\d+)/);
      if (match) return match[1];
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Site adapters
  //
  // Adapter interface:
  //   id         string   unique, used to namespace the cache
  //   isFilmPage()         boolean  is the current URL a film page on this site?
  //   getKey()             string   stable id for the current film (cache key)
  //   extract()            {title, year, imdbId, tmdbId} | null
  //   inject(url, settings, type)   idempotently place link(s) in the page
  //   isInjected(settings) boolean  are this site's links already present?
  // Top-level injected nodes must carry INJECTED_CLASS so the engine can clean
  // them up on navigation; anchors come from createPlexAnchor/createPlexButton.
  // ---------------------------------------------------------------------------

  const LETTERBOXD = {
    id: 'letterboxd',

    isFilmPage() {
      return location.hostname.endsWith('letterboxd.com') &&
             location.pathname.startsWith('/film/');
    },

    getKey() {
      return location.pathname.split('/').filter(Boolean)[1] || location.pathname;
    },

    extract() {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      const headline = document.querySelector('h1.headline-1')?.innerText ||
                       document.querySelector('section#featured-film-header h1')?.innerText ||
                       document.querySelector('.film-header-group h1')?.innerText || '';

      const title = sanitizeText(headline || ogTitle).replace(/\s*\(\d{4}\)\s*$/, '').trim();

      let year = '';
      const yearEl = document.querySelector('.releaseyear a') || document.querySelector('.releaseyear');
      if (yearEl) {
        year = sanitizeText(yearEl.innerText);
      } else {
        const yearMatch = (ogTitle || document.title).match(/\((\d{4})\)/);
        if (yearMatch) year = yearMatch[1];
      }

      let tmdbId = '';
      const tmdbLink = document.querySelector('a[href*="themoviedb.org/movie/"]');
      if (tmdbLink) {
        const match = tmdbLink.href.match(/movie\/(\d+)/);
        if (match) tmdbId = match[1];
      }

      return { title, year, imdbId: readImdbIdFromLinks(), tmdbId };
    },

    inject(url, settings, type) {
      if (settings.showSidebarButton) {
        this._injectSidebarButton(url, settings, type);
      } else {
        document.getElementById('plex-sidebar-action-container')?.remove();
      }

      if (settings.showWatchPanel) {
        this._injectWatchPanelBadge(url, settings, type);
      } else {
        document.getElementById('service-plex-discover')?.remove();
      }

      if (settings.showDetailsLink) {
        this._injectHeaderMetadataLink(url, settings, type);
      } else {
        document.getElementById('plex-header-meta-link')?.remove();
      }
    },

    isInjected(settings) {
      if (!settings) return false;
      return (!settings.showSidebarButton || document.getElementById('plex-sidebar-action-container')) &&
             (!settings.showWatchPanel || document.getElementById('service-plex-discover')) &&
             (!settings.showDetailsLink || document.getElementById('plex-header-meta-link'));
    },

    _injectSidebarButton(url, settings, type) {
      if (document.getElementById('plex-sidebar-action-container')) return;

      const targetContainer = document.querySelector('ul.film-stats') ||
                              document.querySelector('.actions-panel') ||
                              document.querySelector('aside.sidebar .sidebar-content');
      if (!targetContainer) return;

      const actionWrapper = document.createElement('div');
      actionWrapper.id = 'plex-sidebar-action-container';
      actionWrapper.className = `plex-sidebar-action ${INJECTED_CLASS}`;
      actionWrapper.appendChild(createPlexButton(url, settings, type, 'plex-sidebar-btn'));

      if (targetContainer.tagName === 'UL') {
        const li = document.createElement('li');
        li.className = INJECTED_CLASS;
        li.style.listStyle = 'none';
        li.style.margin = '8px 0';
        li.appendChild(actionWrapper);
        targetContainer.parentNode.insertBefore(li, targetContainer.nextSibling);
      } else {
        targetContainer.appendChild(actionWrapper);
      }
    },

    _createWatchBadge(url, settings, type) {
      const plexServiceItem = document.createElement('p');
      plexServiceItem.id = 'service-plex-discover';
      plexServiceItem.className = `service -plex ${INJECTED_CLASS}${type === 'server' ? ' on-server' : ''}`;

      const link = createPlexAnchor(url, settings, type, 'label track-event tooltip');
      link.setAttribute('data-original-title', 'View on Plex');

      const brand = document.createElement('span');
      brand.className = 'brand';
      brand.appendChild(createPlexIcon());
      link.appendChild(brand);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'title';
      titleSpan.textContent = 'Plex';
      link.appendChild(titleSpan);

      plexServiceItem.appendChild(link);
      return plexServiceItem;
    },

    _injectWatchPanelBadge(url, settings, type) {
      if (document.getElementById('service-plex-discover')) return;

      const servicesList = document.querySelector('section.services') ||
                           document.querySelector('.services') ||
                           document.querySelector('div.js-watch-panel .services');

      if (servicesList) {
        servicesList.insertBefore(this._createWatchBadge(url, settings, type), servicesList.firstChild);
      } else {
        const notStreamingMsg = document.querySelector('.js-not-streaming') ||
                                document.querySelector('section.watch-panel .other.-message');
        if (notStreamingMsg && notStreamingMsg.parentNode) {
          const customServices = document.createElement('section');
          customServices.className = `services ${INJECTED_CLASS}`;
          customServices.appendChild(this._createWatchBadge(url, settings, type));
          notStreamingMsg.parentNode.insertBefore(customServices, notStreamingMsg);
        }
      }
    },

    _injectHeaderMetadataLink(url, settings, type) {
      if (document.getElementById('plex-header-meta-link')) return;

      const externalLinksContainer = document.querySelector('a[data-track-action="IMDb"]')?.parentNode ||
                                     document.querySelector('a[data-track-action="TMDB"]')?.parentNode ||
                                     document.querySelector('.track-event[href*="imdb.com"]')?.parentNode;

      if (externalLinksContainer) {
        const metaLink = createPlexAnchor(url, settings, type, `plex-meta-link ${INJECTED_CLASS}`);
        metaLink.id = 'plex-header-meta-link';
        metaLink.title = 'View on Plex';
        metaLink.appendChild(createPlexIcon());
        metaLink.appendChild(document.createTextNode(' Plex'));
        externalLinksContainer.appendChild(metaLink);
      }
    }
  };

  const IMDB = {
    id: 'imdb',

    isFilmPage() {
      return /(^|\.)imdb\.com$/.test(location.hostname) &&
             /^\/title\/tt\d+/.test(location.pathname);
    },

    getKey() {
      const m = location.pathname.match(/\/title\/(tt\d+)/);
      return m ? m[1] : location.pathname;
    },

    extract() {
      const idMatch = location.pathname.match(/\/title\/(tt\d+)/);
      const imdbId = idMatch ? idMatch[1] : '';

      let title = '';
      let year = '';

      // Primary: JSON-LD is clean and locale-independent.
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const parsed = JSON.parse(script.textContent);
          const node = Array.isArray(parsed) ? parsed.find(d => d && d.name) : parsed;
          if (node && typeof node.name === 'string' && node.name) {
            title = sanitizeText(node.name);
            if (typeof node.datePublished === 'string' && /^\d{4}/.test(node.datePublished)) {
              year = node.datePublished.slice(0, 4);
            }
            break;
          }
        } catch (e) { /* ignore malformed blocks */ }
      }

      // Fallback: hero heading, then og:title.
      if (!title) {
        const h1 = document.querySelector('h1[data-testid="hero__pageTitle"]');
        if (h1) title = sanitizeText(h1.textContent);
      }
      if (!title) {
        const og = document.querySelector('meta[property="og:title"]')?.content || '';
        title = sanitizeText(og.replace(/\s[-–|]\s.*$/, ''));
        const ym = og.match(/\((\d{4})\)/);
        if (ym && !year) year = ym[1];
      }
      if (!year) {
        const relEl = document.querySelector('a[href*="releaseinfo"]');
        const ym = relEl && sanitizeText(relEl.textContent).match(/\d{4}/);
        if (ym) year = ym[0];
      }

      title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
      if (!title && !imdbId) return null;
      return { title, year, imdbId, tmdbId: '' };
    },

    inject(url, settings, type) {
      if (!settings.showImdbButton) return;
      if (document.getElementById('plexhop-imdb-btn')) return;

      const h1 = document.querySelector('h1[data-testid="hero__pageTitle"]');
      const host = h1 && h1.parentElement;
      if (!host) return;

      const btn = createPlexButton(url, settings, type, 'plexhop-imdb-btn');
      btn.id = 'plexhop-imdb-btn';
      btn.classList.add(INJECTED_CLASS);
      host.appendChild(btn);
    },

    isInjected(settings) {
      if (!settings.showImdbButton) return true; // nothing to inject
      return !!document.getElementById('plexhop-imdb-btn');
    }
  };

  const SITE_ADAPTERS = [LETTERBOXD, IMDB];

  function getActiveAdapter() {
    return SITE_ADAPTERS.find(a => a.isFilmPage()) || null;
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([
        'plexToken',
        'openInNewTab',
        'showSidebarButton',
        'showWatchPanel',
        'showDetailsLink',
        'showImdbButton'
      ], (items) => {
        lastSettings = {
          plexToken: items.plexToken || '',
          openInNewTab: items.openInNewTab !== false,
          showSidebarButton: items.showSidebarButton !== false,
          showWatchPanel: items.showWatchPanel !== false,
          showDetailsLink: items.showDetailsLink !== false,
          showImdbButton: items.showImdbButton !== false
        };
        resolve(lastSettings);
      });
    });
  }

  function cacheKey(adapterId, filmKey) {
    return `${CACHE_PREFIX}${adapterId}_${filmKey}`;
  }

  function getCachedResult(adapterId, filmKey) {
    return new Promise((resolve) => {
      const key = cacheKey(adapterId, filmKey);
      chrome.storage.local.get(key, (items) => {
        const data = items[key];
        if (data && data.url && Date.now() - data.timestamp < CACHE_TTL) {
          resolve(data);
        } else {
          resolve(null);
        }
      });
    });
  }

  function setCachedResult(adapterId, filmKey, result) {
    chrome.storage.local.set({
      [cacheKey(adapterId, filmKey)]: { ...result, timestamp: Date.now() }
    });
  }

  // ---------------------------------------------------------------------------
  // Engine
  // ---------------------------------------------------------------------------

  function currentFilmToken() {
    const adapter = getActiveAdapter();
    return adapter ? `${adapter.id}|${adapter.getKey()}` : null;
  }

  // Re-apply the stored display state to whatever links are currently in the
  // page — but only if it still describes the film on screen.
  function applyDisplayState(token) {
    if (displayState && displayState.token === token) {
      updateAllInjectedLinks(displayState.url, displayState.type, displayState.serverName);
    }
  }

  async function injectPlexLinks() {
    const adapter = getActiveAdapter();
    if (!adapter) return;

    const movie = adapter.extract();
    if (!movie || !movie.title) return;

    const settings = await getSettings();
    const filmKey = adapter.getKey();
    const filmToken = `${adapter.id}|${filmKey}`;

    let activeType = 'search';
    let activeUrl = getSearchUrl(movie.title, movie.year);

    const cached = await getCachedResult(adapter.id, filmKey);
    if (cached) {
      activeUrl = cached.url;
      activeType = cached.type || 'discover';
    }

    // Seed the display state for this film (unless we already have one, e.g. a
    // resolve is mid-flight and we're just re-rendering).
    if (!displayState || displayState.token !== filmToken) {
      displayState = { token: filmToken, url: activeUrl, type: activeType };
    }

    adapter.inject(displayState.url, settings, displayState.type);
    applyDisplayState(filmToken);

    // Resolve the real destination via the background worker if not cached.
    if (!cached && settings.plexToken && !isResolving) {
      isResolving = true;
      displayState = { token: filmToken, url: activeUrl, type: 'checking' };
      applyDisplayState(filmToken);
      try {
        const resolved = await chrome.runtime.sendMessage({ action: 'resolveMovie', movie });
        if (resolved && resolved.url && !resolved.error) {
          setCachedResult(adapter.id, filmKey, resolved);
          if (currentFilmToken() === filmToken) {
            displayState = { token: filmToken, url: resolved.url, type: resolved.type, serverName: resolved.serverName };
          }
        } else if (currentFilmToken() === filmToken) {
          displayState = { token: filmToken, url: activeUrl, type: 'search' };
        }
      } catch (e) {
        console.warn('[PlexHop] Resolve failed:', e);
        if (currentFilmToken() === filmToken) {
          displayState = { token: filmToken, url: activeUrl, type: 'search' };
        }
      } finally {
        isResolving = false;
        applyDisplayState(filmToken);
      }
    }
  }

  function updateAllInjectedLinks(url, type, serverName) {
    const checking = type === 'checking';

    document.querySelectorAll(`.${LINK_CLASS}`).forEach((el) => {
      if (url) el.href = url;
      el.classList.toggle('on-server', type === 'server');
      el.classList.toggle('plexhop-checking', checking);
      if (type === 'server' && serverName) {
        el.title = `Watch on Plex Server (${serverName})`;
      } else if (checking) {
        el.title = 'Checking Plex…';
      } else {
        el.title = 'Open in Plex';
      }
    });

    document.querySelectorAll('.plex-badge-mode').forEach((el) => {
      el.className = `plex-badge-mode ${type}`;
      el.textContent = badgeLabelFor(type);
    });

    const watchBadge = document.getElementById('service-plex-discover');
    if (watchBadge) {
      watchBadge.classList.toggle('on-server', type === 'server');
      watchBadge.classList.toggle('plexhop-checking', checking);
    }
  }

  function removeAllInjected() {
    document.querySelectorAll(`.${INJECTED_CLASS}`).forEach((el) => el.remove());
  }

  function allLinksInjected() {
    const adapter = getActiveAdapter();
    if (!adapter) return true; // nothing to inject here
    return adapter.isInjected(lastSettings);
  }

  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    setTimeout(() => {
      injectScheduled = false;
      if (getActiveAdapter()) injectPlexLinks();
    }, 250);
  }

  function handleUrlChange() {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      removeAllInjected();
      scheduleInject();
    }
  }

  function init() {
    currentUrl = location.href;
    if (getActiveAdapter()) injectPlexLinks();

    const observer = new MutationObserver(() => {
      handleUrlChange();
      // Sites re-render dynamically; re-inject if our nodes were wiped, but
      // skip the work when everything expected is already present.
      if (getActiveAdapter() && !allLinksInjected()) {
        scheduleInject();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') scheduleInject();
    });
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
