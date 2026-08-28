# PlexHop

Hop straight to **Plex** from the movie sites you already browse. PlexHop is a clean, lightweight Chrome / Brave extension (and Tampermonkey userscript) that adds a one-click link to your Plex server, **Plex Discover**, or Plex search on every film page.

![PlexHop](icons/icon128.png)

**Supported sources today:** [Letterboxd](https://letterboxd.com), [IMDb](https://www.imdb.com). **Planned:** TMDB and TV sites — the architecture is built to add sources without changing how linking works.

> **Unofficial**: This project is not affiliated with, endorsed by, or sponsored by Plex, Letterboxd, or any other site it links from. "Plex", "Letterboxd", and other names are trademarks of their respective owners.

---

## Features

- **"Open in Plex" everywhere it makes sense**:
  - On **Letterboxd** film pages — a Plex badge in the "Where to watch" panel, an "Open in Plex" button in the sidebar, and a Plex link beside the IMDb / TMDb links.
  - On **IMDb** title pages — an "Open in Plex" button under the title.
- **Smart link destinations** — with an optional Plex token, links deep-link straight to the film **on your own Plex server** if it's in your library, falling back to the film's **Plex Discover** page. Without a token, links open Plex search — zero setup required.
- **Accurate matching** — films are matched by IMDb ID when available, with title + year as fallback. No confident match means a search link, never a wrong film.
- **Fast** — resolved links are cached for 7 days, so revisiting a film makes zero network calls.
- **SPA-friendly** — links survive dynamic page updates and back/forward navigation.
- **Private by design** — no analytics, no tracking, no third-party servers. Your Plex token stays on your device and is only ever sent to Plex's own APIs, always as a header. See [PRIVACY.md](PRIVACY.md).

## Install

### Option 1: Chrome / Brave extension

Until PlexHop is on the Chrome Web Store, load it unpacked:

1. Clone this repository:
   ```bash
   git clone https://github.com/mattcoady/letterboxd-to-plex.git
   ```
2. Open the extensions page — `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the cloned directory.
5. Click the PlexHop icon in the toolbar to open settings.

### Option 2: Tampermonkey / Violentmonkey userscript

1. Open your Tampermonkey dashboard and click **Add a new script** (`+`).
2. Paste the contents of [`letterboxd-to-plex.user.js`](letterboxd-to-plex.user.js) and save (`Ctrl+S` / `Cmd+S`).
3. (Optional) On a supported site, use the Tampermonkey menu → **"⚙️ Configure Plex Token"** to enter your token.

---

## Setup (optional)

PlexHop works out of the box with search links. For direct deep-links to your server or Plex Discover, it needs your Plex token:

**Easiest** — in the popup, enable **"Auto-sync token from app.plex.tv"** (off by default), then visit [app.plex.tv](https://app.plex.tv) while signed in. The token is picked up from your own session automatically.

**Manually**:

1. Sign in at [app.plex.tv](https://app.plex.tv) and open any item in your library.
2. `...` (More) menu → **Get Info** → **View XML**.
3. Copy the `X-Plex-Token=...` value from the end of the URL in the address bar.
4. Paste it into the popup and hit **Save Settings**.

Use **Test Token & Server** in the popup to verify it works — it shows your account name and detected servers.

### Settings

| Setting | Default | What it does |
|---|---|---|
| Plex Token | empty | Enables server / Discover deep-linking |
| Auto-sync token | off | Reads the token from your own app.plex.tv session |
| Link Destination Priority | Smart | Server first → Discover → Search, or pin one destination |
| Display Locations | all on | Choose which of the link placements to show |
| Open in new tab | on | Open Plex links in a new tab |

**Note on server connections**: PlexHop only contacts your servers over their secure `*.plex.direct` HTTPS addresses (Plex's default for all signed-in servers). Servers reachable only via plain-HTTP LAN addresses won't be found.

---

## How it works

- A content script reads the film's title, year, and IMDb/TMDb IDs from the page and injects the links.
- All Plex API calls happen in the background service worker, which only has permission for Plex's own domains (`plex.tv`, `discover.provider.plex.tv`, `*.plex.direct`).
- With a token, it searches your servers' libraries (`/hubs/search`) and Plex Discover, matching by IMDb ID first, then normalized title + year (±1).
- Results are cached locally for 7 days (clearable from the popup).

Adding a new source (IMDb, TMDB, …) means teaching the content script how to scrape a title/year/IMDb-ID from that site and adding its match pattern to the manifest — the resolution and linking logic in the background worker stays the same.

---

## Roadmap

- [x] Letterboxd support
- [x] IMDb support
- [ ] TMDB support
- [ ] TV / show sources
- [ ] Chrome Web Store listing

---

## Development

```
manifest.json     MV3 manifest
background.js     Service worker — all Plex API calls
content.js        Per-site DOM scraping + link injection
content.css       Injected link styling
plex-sync.js      Opt-in token auto-sync on app.plex.tv
popup.html/js/css Settings popup
letterboxd-to-plex.user.js  Standalone Tampermonkey variant
generate_icons.py Regenerates the icon PNGs
```

Test on any Letterboxd film page (e.g. [The Dark Knight](https://letterboxd.com/film/the-dark-knight/)) or IMDb title page (e.g. [Inception](https://www.imdb.com/title/tt1375666/)).

### Adding a new source

`content.js` is a site-agnostic engine plus a `SITE_ADAPTERS` registry. To support a new site, add one adapter object and its match pattern — no engine changes:

1. Add an adapter to the `SITE_ADAPTERS` array in [`content.js`](content.js) implementing:
   | Method | Returns | Purpose |
   |---|---|---|
   | `id` | string | Unique key, namespaces the cache |
   | `isFilmPage()` | boolean | Is the current URL a film page on this site? |
   | `getKey()` | string | Stable per-film id (used as cache key) |
   | `extract()` | `{title, year, imdbId, tmdbId}` \| `null` | Scrape the film from the page |
   | `inject(url, settings, type)` | — | Idempotently place link(s) in the DOM |
   | `isInjected(settings)` | boolean | Are this site's links already present? |
2. Add the site's URL pattern to `content_scripts[0].matches` in [`manifest.json`](manifest.json).
3. (Optional) Add site-specific styling to [`content.css`](content.css).

Injected top-level nodes must carry the `plexhop-injected` class (so the engine can clean them up on navigation); build anchors with the shared `createPlexAnchor` / `createPlexButton` helpers so they get the `plexhop-link` marker and update automatically once resolution completes. The IMDb adapter is a minimal reference; the Letterboxd adapter shows multiple placements.

### Packaging for the Chrome Web Store

```bash
zip -r plexhop.zip manifest.json background.js content.js content.css plex-sync.js popup.html popup.js popup.css icons
```

Store listing reminders:
- Set the privacy policy URL to this repo's [PRIVACY.md](PRIVACY.md).
- In the dashboard Privacy tab, disclose that the extension handles **authentication information** (the Plex token), stored locally only.

---

## Privacy

No analytics, no tracking, no data collection. Everything is stored locally and network requests go only to Plex. Full details in [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
