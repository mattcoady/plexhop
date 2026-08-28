# Privacy Policy — Letterboxd to Plex

_Last updated: August 27, 2026_

**Letterboxd to Plex** is a browser extension that adds links to Plex on Letterboxd film pages. It is designed to collect as little data as possible, and nothing it handles ever leaves your device except requests made directly to Plex's own services.

## What the extension stores

All data is stored locally in your browser via `chrome.storage.local` and is never transmitted to the developer or any third party:

- **Plex authentication token** (optional): only if you paste one into the settings popup, or if you explicitly enable the off-by-default "Auto-sync token from app.plex.tv" option, in which case the token is read from your own signed-in app.plex.tv session. The token is used solely to query Plex's APIs on your behalf.
- **Settings**: your display and behavior preferences.
- **Film link cache**: mappings from Letterboxd films to Plex URLs, kept for 7 days to avoid repeated lookups. You can clear this at any time from the popup.
- **A random client identifier**: generated locally, sent only to Plex as the standard `X-Plex-Client-Identifier` header.

## What the extension sends, and to whom

Network requests are made only to Plex services, and only when you have provided a token:

- `plex.tv` — to verify your token and list your own Plex servers.
- `discover.provider.plex.tv` — to look up films on Plex Discover.
- Your own Plex server(s) via their secure `*.plex.direct` addresses — to check whether a film is in your library.

Each request includes your Plex token (as a header) because Plex requires it for authentication. No data is ever sent to Letterboxd beyond loading the pages you visit normally, and no data is ever sent to the developer.

## What the extension does NOT do

- No analytics, telemetry, or tracking of any kind.
- No collection of browsing history.
- No selling, sharing, or transferring of user data to anyone.
- No use of data for purposes unrelated to the extension's single purpose: linking Letterboxd film pages to Plex.

## Data removal

Uninstalling the extension removes all stored data. You can also clear the film cache from the popup, or remove your token by clearing the token field and saving.

## Contact

Questions about this policy can be raised by opening an issue on the project's repository.
