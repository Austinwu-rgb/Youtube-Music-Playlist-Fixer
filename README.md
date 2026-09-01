# YouTube Music Replacer

A Chrome extension that finds unplayable tracks in your YouTube Music playlists and lets you replace them one-by-one with working alternatives — all through the official YouTube Data API.

## Demo:

https://github.com/user-attachments/assets/9ef1cf91-230d-4809-827d-4e051dec1540





## What it does

YouTube Music sometimes shows tracks as unavailable (greyed out) even though the same video still exists on regular YouTube. This extension:

1. **Scans** your playlist on `music.youtube.com` by scrolling through it and detecting DOM signals for unplayable tracks.
2. **Walks you through** each broken track — you can Replace or Skip.
3. **Searches** for replacement candidates (ranked by channel quality).
4. **Replaces** the track at its exact playlist position using `playlistItems.insert` then `playlistItems.delete`.

No unofficial YouTube Music API is used. Detection is done via DOM; fixes go through the official YouTube Data API v3.

## Quick start

See **[docs/SETUP.md](docs/SETUP.md)** for the full setup guide, including:

- Building the extension
- Pinning the extension ID (required for OAuth)
- Creating a Chrome Extension OAuth client in Google Cloud
- Adding test users to the OAuth consent screen
- Setting playlist sort order to Manual

## Architecture

```
Chrome Extension (Manifest V3)
├── background/service-worker.ts   — OAuth, all YouTube API calls, state machine
├── content/index.ts               — DOM scan, scroll, highlight (runs on music.youtube.com)
│   ├── scanner.ts                 — Scroll-until-stable, unplayable detection
│   └── highlighter.ts             — Scroll-to-track + red outline ring
├── sidepanel/app.ts               — UI: sign-in → scan → review → fix → done
└── lib/
    ├── auth.ts                    — chrome.identity.getAuthToken
    ├── youtube-api.ts             — Authenticated fetch with 401 retry
    ├── playlist.ts                — listPlaylistItems, position re-fetch
    ├── search.ts                  — search.list + rank candidates
    ├── replace.ts                 — insertAt, deleteItem
    ├── backup.ts                  — Download JSON snapshot before first edit
    ├── quota.ts                   — Daily unit tracker (10k/day limit)
    ├── dom-selectors.ts           — Centralised YT Music CSS selectors
    ├── messages.ts                — Typed chrome.runtime message protocol
    └── session.ts                 — chrome.storage.session state persistence
```

## Development

```powershell
npm install
npm run dev       # watch mode — rebuild on file changes
npm run build     # one-shot production build → build/
```

Load the `build/` folder as an unpacked extension in `chrome://extensions`.

## Privacy

No data is sent to any server other than Google's YouTube API. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Tech stack

- Chrome Manifest V3 (service worker, side panel, content script)
- TypeScript (strict mode)
- Vite + @crxjs/vite-plugin
- Vanilla DOM for the side panel UI (no framework)
- YouTube Data API v3 + chrome.identity OAuth

## Limitations

- Playlist sort must be set to **Manual** in YouTube Music for position-aware inserts to work.
- Only playlists you **own** can be edited via the YouTube Data API.
- `search.list` costs 100 API units per track; default daily quota is 10,000 units.
- DOM selectors may break after a YouTube Music UI update — fix in `lib/dom-selectors.ts`.
