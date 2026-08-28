# Letterboxd to Plex

A clean, lightweight Chrome / Brave extension (and Tampermonkey userscript) that adds direct links to **Plex** — your personal server, **Plex Discover**, or Universal Search — from any film page on [Letterboxd](https://letterboxd.com).

![Plex & Letterboxd](icons/icon128.png)

> **Unofficial**: This project is not affiliated with, endorsed by, or sponsored by Letterboxd or Plex. "Letterboxd" and "Plex" are trademarks of their respective owners.

---

## Features

- **"Open in Plex" everywhere it makes sense** — the extension adds:
  - a Plex badge in the **"Where to watch"** panel,
  - an **"Open in Plex"** action button in the sidebar under the poster,
  - a quick **Plex** link beside the IMDb / TMDb links.
- **Smart link destinations** — with an optional Plex token, links deep-link straight to the film **on your own Plex server** if it's in your library, falling back to the film's **Plex Discover** page. Without a token, links open Plex Universal Search — zero setup required.
- **Accurate matching** — films are matched by IMDb ID when available, with title + year as fallback. No confident match means a search link, never a wrong film.
- **Fast** — resolved links are cached for 7 days, so revisiting a film makes zero network calls.
- **SPA-friendly** — links survive Letterboxd's dynamic page updates and back/forward navigation.
- **Private by design** — no analytics, no tracking, no third-party servers. Your Plex token stays on your device and is only ever sent to Plex's own APIs, always as a header. See [PRIVACY.md](PRIVACY.md).

## Install

### Option 1: Chrome / Brave extension

Until the extension is on the Chrome Web Store, load it unpacked:

1. Clone this repository:
   ```bash
   git clone https://github.com/mattcoady/letterboxd-to-plex.git
   ```
2. Open the extensions page — `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the cloned `letterboxd-to-plex` directory.
5. Click the extension icon in the toolbar to open settings.

### Option 2: Tampermonkey / Violentmonkey userscript

1. Open your Tampermonkey dashboard and click **Add a new script** (`+`).
2. Paste the contents of [`letterboxd-to-plex.user.js`](letterboxd-to-plex.user.js) and save (`Ctrl+S` / `Cmd+S`).
3. (Optional) While on Letterboxd, use the Tampermonkey menu → **"⚙️ Configure Plex Token"** to enter your token.

---

## Setup (optional)

The extension works out of the box with search links. For direct deep-links to your server or Plex Discover, it needs your Plex token:

**Easiest** — in the extension popup, enable **"Auto-sync token from app.plex.tv"** (off by default), then visit [app.plex.tv](https://app.plex.tv) while signed in. The token is picked up from your own session automatically.

**Manually**:

1. Sign in at [app.plex.tv](https://app.plex.tv) and open any item in your library.
2. `...` (More) menu → **Get Info** → **View XML**.
3. Copy the `X-Plex-Token=...` value from the end of the URL in the address bar.
4. Paste it into the extension popup and hit **Save Settings**.

Use **Test Token & Server** in the popup to verify it works — it shows your account name and detected servers.

### Settings

| Setting | Default | What it does |
|---|---|---|
| Plex Token | empty | Enables server / Discover deep-linking |
| Auto-sync token | off | Reads the token from your own app.plex.tv session |
| Link Destination Priority | Smart | Server first → Discover → Search, or pin one destination |
| Display Locations | all on | Choose which of the three link placements to show |
| Open in new tab | on | Open Plex links in a new tab |

**Note on server connections**: the extension only contacts your servers over their secure `*.plex.direct` HTTPS addresses (Plex's default for all signed-in servers). Servers reachable only via plain-HTTP LAN addresses won't be found.

---

## How it works

- A content script on `letterboxd.com/film/*` reads the film's title, year, and IMDb/TMDb IDs from the page and injects the links.
- All Plex API calls happen in the extension's background service worker, which only has permission for Plex's own domains (`plex.tv`, `discover.provider.plex.tv`, `*.plex.direct`).
- With a token, it searches your servers' libraries (`/hubs/search`) and Plex Discover, matching by IMDb ID first, then normalized title + year (±1).
- Results are cached locally for 7 days (clearable from the popup).

---

## Development

```
manifest.json     MV3 manifest
background.js     Service worker — all Plex API calls
content.js        Letterboxd DOM injection
content.css       Injected link styling
plex-sync.js      Opt-in token auto-sync on app.plex.tv
popup.html/js/css Settings popup
letterboxd-to-plex.user.js  Standalone Tampermonkey variant
generate_icons.py Regenerates the icon PNGs
```

Test on any film page, e.g. [The Dark Knight](https://letterboxd.com/film/the-dark-knight/), [Parasite](https://letterboxd.com/film/parasite-2019/).

### Packaging for the Chrome Web Store

```bash
zip -r letterboxd-to-plex.zip manifest.json background.js content.js content.css plex-sync.js popup.html popup.js popup.css icons
```

Store listing reminders:
- Set the privacy policy URL to this repo's [PRIVACY.md](PRIVACY.md).
- In the dashboard Privacy tab, disclose that the extension handles **authentication information** (the Plex token), stored locally only.

---

## Privacy

No analytics, no tracking, no data collection. Everything is stored locally and network requests go only to Plex. Full details in [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
