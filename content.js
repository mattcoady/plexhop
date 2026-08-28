// PlexHop - Content Script
// Injects Plex links into Letterboxd film pages. All Plex API calls are
// delegated to the background service worker; this script only touches the DOM.
(function () {
  'use strict';

  const CACHE_PREFIX = 'cacheTarget_';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  let currentPath = '';
  let isResolving = false;
  let injectScheduled = false;
  let lastSettings = null;

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

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([
        'plexToken',
        'openInNewTab',
        'showSidebarButton',
        'showWatchPanel',
        'showDetailsLink'
      ], (items) => {
        lastSettings = {
          plexToken: items.plexToken || '',
          openInNewTab: items.openInNewTab !== false,
          showSidebarButton: items.showSidebarButton !== false,
          showWatchPanel: items.showWatchPanel !== false,
          showDetailsLink: items.showDetailsLink !== false
        };
        resolve(lastSettings);
      });
    });
  }

  function getCachedResult(slug) {
    return new Promise((resolve) => {
      const key = CACHE_PREFIX + slug;
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

  function setCachedResult(slug, result) {
    chrome.storage.local.set({
      [CACHE_PREFIX + slug]: { ...result, timestamp: Date.now() }
    });
  }

  // Extract movie info
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

    let tmdbId = '';
    const tmdbLink = document.querySelector('a[href*="themoviedb.org/movie/"]');
    if (tmdbLink) {
      const match = tmdbLink.href.match(/movie\/(\d+)/);
      if (match) tmdbId = match[1];
    }

    return { title, year, imdbId, tmdbId, slug };
  }

  function getSearchUrl(title, year) {
    const cleanTitle = sanitizeText(title);
    const cleanYear = sanitizeText(year);
    const q = cleanYear ? `${cleanTitle} ${cleanYear}` : cleanTitle;
    return `https://app.plex.tv/desktop/#!/search?query=${encodeURIComponent(q)}`;
  }

  function badgeLabelFor(type) {
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

  // Main injection logic respecting user location configurations
  async function injectPlexLinks() {
    const movie = extractMovieInfo();
    if (!movie || !movie.title) return;

    const settings = await getSettings();

    let activeType = 'search';
    let activeUrl = getSearchUrl(movie.title, movie.year);

    const cached = await getCachedResult(movie.slug);
    if (cached) {
      activeUrl = cached.url;
      activeType = cached.type || 'discover';
    }

    // 1. Sidebar Button
    if (settings.showSidebarButton) {
      injectSidebarButton(activeUrl, settings, activeType);
    } else {
      document.getElementById('plex-sidebar-action-container')?.remove();
    }

    // 2. Where to Watch Badge
    if (settings.showWatchPanel) {
      injectWatchPanelBadge(activeUrl, settings, activeType);
    } else {
      document.getElementById('service-plex-discover')?.remove();
    }

    // 3. Details Metadata Link
    if (settings.showDetailsLink) {
      injectHeaderMetadataLink(activeUrl, settings, activeType);
    } else {
      document.getElementById('plex-header-meta-link')?.remove();
    }

    // Async resolve via the background worker if not cached
    if (!cached && settings.plexToken && !isResolving) {
      isResolving = true;
      try {
        const resolved = await chrome.runtime.sendMessage({ action: 'resolveMovie', movie });
        if (resolved && resolved.url && !resolved.error) {
          setCachedResult(movie.slug, resolved);
          updateAllInjectedLinks(resolved.url, resolved.type, resolved.serverName);
        }
      } catch (e) {
        console.warn('[PlexHop] Resolve failed:', e);
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
      el.textContent = badgeLabelFor(type);
    });

    const watchBadge = document.getElementById('service-plex-discover');
    if (watchBadge) {
      watchBadge.classList.toggle('on-server', type === 'server');
    }
  }

  function createPlexAnchor(url, settings, type, className) {
    const a = document.createElement('a');
    a.href = url;
    a.className = `${className} lb-plex-link${type === 'server' ? ' on-server' : ''}`;
    applyLinkTarget(a, settings);
    return a;
  }

  function injectSidebarButton(url, settings, type) {
    if (document.getElementById('plex-sidebar-action-container')) return;

    const targetContainer = document.querySelector('ul.film-stats') ||
                            document.querySelector('.actions-panel') ||
                            document.querySelector('aside.sidebar .sidebar-content');
    if (!targetContainer) return;

    const actionWrapper = document.createElement('div');
    actionWrapper.id = 'plex-sidebar-action-container';
    actionWrapper.className = 'plex-sidebar-action';

    const link = createPlexAnchor(url, settings, type, 'plex-sidebar-btn');
    link.title = 'Open in Plex';
    link.appendChild(createPlexIcon());

    const label = document.createElement('span');
    label.textContent = 'Open in Plex';
    link.appendChild(label);

    const badge = document.createElement('span');
    badge.className = `plex-badge-mode ${type}`;
    badge.textContent = badgeLabelFor(type);
    link.appendChild(badge);

    actionWrapper.appendChild(link);

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

  function createWatchBadge(url, settings, type) {
    const plexServiceItem = document.createElement('p');
    plexServiceItem.id = 'service-plex-discover';
    plexServiceItem.className = `service -plex${type === 'server' ? ' on-server' : ''}`;

    const link = createPlexAnchor(url, settings, type, 'label track-event tooltip');
    link.setAttribute('data-original-title', 'View on Plex');

    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.appendChild(createPlexIcon());
    link.appendChild(brand);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = 'Plex';
    link.appendChild(title);

    plexServiceItem.appendChild(link);
    return plexServiceItem;
  }

  function injectWatchPanelBadge(url, settings, type) {
    if (document.getElementById('service-plex-discover')) return;

    const servicesList = document.querySelector('section.services') ||
                         document.querySelector('.services') ||
                         document.querySelector('div.js-watch-panel .services');

    if (servicesList) {
      servicesList.insertBefore(createWatchBadge(url, settings, type), servicesList.firstChild);
    } else {
      const notStreamingMsg = document.querySelector('.js-not-streaming') ||
                              document.querySelector('section.watch-panel .other.-message');
      if (notStreamingMsg && notStreamingMsg.parentNode) {
        const customServices = document.createElement('section');
        customServices.className = 'services';
        customServices.appendChild(createWatchBadge(url, settings, type));
        notStreamingMsg.parentNode.insertBefore(customServices, notStreamingMsg);
      }
    }
  }

  function injectHeaderMetadataLink(url, settings, type) {
    if (document.getElementById('plex-header-meta-link')) return;

    const externalLinksContainer = document.querySelector('a[data-track-action="IMDb"]')?.parentNode ||
                                   document.querySelector('a[data-track-action="TMDB"]')?.parentNode ||
                                   document.querySelector('.track-event[href*="imdb.com"]')?.parentNode;

    if (externalLinksContainer) {
      const metaLink = createPlexAnchor(url, settings, type, 'plex-meta-link');
      metaLink.id = 'plex-header-meta-link';
      metaLink.title = 'View on Plex';
      metaLink.appendChild(createPlexIcon());
      metaLink.appendChild(document.createTextNode(' Plex'));
      externalLinksContainer.appendChild(metaLink);
    }
  }

  function allLinksInjected() {
    if (!lastSettings) return false;
    return (!lastSettings.showSidebarButton || document.getElementById('plex-sidebar-action-container')) &&
           (!lastSettings.showWatchPanel || document.getElementById('service-plex-discover')) &&
           (!lastSettings.showDetailsLink || document.getElementById('plex-header-meta-link'));
  }

  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    setTimeout(() => {
      injectScheduled = false;
      if (window.location.pathname.startsWith('/film/')) {
        injectPlexLinks();
      }
    }, 250);
  }

  function handleUrlChange() {
    if (window.location.pathname !== currentPath) {
      currentPath = window.location.pathname;
      document.getElementById('plex-sidebar-action-container')?.remove();
      document.getElementById('service-plex-discover')?.remove();
      document.getElementById('plex-header-meta-link')?.remove();
      scheduleInject();
    }
  }

  function init() {
    currentPath = window.location.pathname;
    if (currentPath.startsWith('/film/')) {
      injectPlexLinks();
    }

    const observer = new MutationObserver(() => {
      handleUrlChange();
      // Letterboxd re-renders panels dynamically; re-inject if anything
      // was wiped, but skip the work when everything is already in place.
      if (!allLinksInjected()) {
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
