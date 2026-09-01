# YouTube Music Replacer

Chrome extension for fixing greyed-out tracks in YouTube Music playlists. It scans a playlist, finds entries that won't play, and lets you swap each one for a working version through the official YouTube Data API.

## Demo

https://github.com/user-attachments/assets/9ef1cf91-230d-4809-827d-4e051dec1540

## How it works

Sometimes a track shows as unavailable due to various reasons such as if the track is re-uploaded by the artist/publisher. This extension:

1. Scrolls through your playlist on `music.youtube.com` and picks out unplayable tracks from the page DOM.
2. Shows each broken track one at a time. Replace it or skip it.
3. Searches for candidates and ranks them (channel name, duration, etc.).
4. Inserts the replacement at the same playlist position, then deletes the old entry.

Unplayable detection reads the page. Actual playlist edits go through YouTube Data API v3.

## Setup

Build instructions and Google Cloud OAuth setup are in **[docs/SETUP.md](docs/SETUP.md)**. Short version:

- `npm install && npm run build`, then load the `build/` folder at `chrome://extensions`
- Create a Chrome Extension OAuth client (extension ID must match)
- Add your Google account as a test user on the OAuth consent screen
- Set the playlist sort order to **Manual** in YouTube Music before scanning

Chrome only for now. Sign-in uses `chrome.identity.getAuthToken`, which Edge does not support.

## Project layout

```
Chrome Extension (Manifest V3)
├── background/service-worker.ts   OAuth, API calls, state machine
├── content/index.ts               DOM scan and highlight on music.youtube.com
│   ├── scanner.ts                 scroll + unplayable detection
│   └── highlighter.ts             scroll-to-track + outline
├── sidepanel/app.ts               sign in → scan → review → fix
└── lib/
    ├── auth.ts                    chrome.identity.getAuthToken
    ├── youtube-api.ts             authenticated fetch, 401 retry
    ├── playlist.ts                list items, position re-fetch
    ├── search.ts                  search.list + candidate ranking
    ├── replace.ts                 insertAt, deleteItem
    ├── backup.ts                  JSON snapshot before first edit
    ├── quota.ts                   daily API unit counter (10k limit)
    ├── dom-selectors.ts           YT Music CSS selectors (update when UI changes)
    ├── messages.ts                typed chrome.runtime message protocol
    └── session.ts                 chrome.storage.session persistence
```

## Development

```bash
npm install
npm run dev       # watch mode, rebuilds on save
npm run build     # one-shot build to build/
```

Reload the extension at `chrome://extensions` after each rebuild.

## Caveats

- Playlist sort must be **Manual** or inserts at a specific position will fail.
- You can only edit playlists you own.
- Each replacement search costs 100 API units (`search.list`). Default quota is 10,000/day.
- YT Music UI updates can break DOM selectors. Fix them in `lib/dom-selectors.ts`.

No data goes anywhere except Google's YouTube API. Details in [docs/PRIVACY.md](docs/PRIVACY.md).

Built with TypeScript, Vite, and `@crxjs/vite-plugin`. Side panel UI is plain DOM, no framework.
