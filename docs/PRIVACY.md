# Privacy Policy — YouTube Music Replacer

*Last updated: May 2026*

## What this extension does

YouTube Music Replacer is a Chrome extension that helps you find and replace unplayable tracks in your YouTube Music playlists by substituting them with available alternatives.

## Data collected and stored

**No data is collected by the developer.** The extension:

- Does **not** send any data to external servers operated by the developer.
- Does **not** store your playlists, search queries, or listening history anywhere except your own browser.

### Data stored locally in your browser

| Data | Where | Purpose |
|------|-------|---------|
| OAuth access token | `chrome.storage.session` (cleared when Chrome closes) | Authenticates YouTube Data API calls |
| Search result cache | `chrome.storage.local` | Avoids re-searching the same song title (reduces quota usage) |
| Daily API quota counter | `chrome.storage.local` | Shows you how much of your daily quota has been used |
| Session scan/fix state | `chrome.storage.session` | Resumes your place if the extension restarts mid-session |

All of the above data stays on your device. You can clear it at any time via `chrome://settings/content/all` or by removing the extension.

### Backup files

When you confirm your first replacement, the extension optionally downloads a JSON backup of your playlist to your computer's Downloads folder. This file contains only your playlist item list (video IDs, titles, positions). It is stored locally and never transmitted anywhere.

## Third-party services

The extension communicates **only** with Google's YouTube Data API v3:

- `https://www.googleapis.com/youtube/v3/` — to list your playlist, search for replacements, insert new items, and delete broken items.
- `https://oauth2.googleapis.com/` — to refresh and revoke your OAuth token.

These calls are made on your behalf and are subject to [Google's Privacy Policy](https://policies.google.com/privacy).

No other third-party services, analytics, or tracking scripts are included.

## Permissions used

| Permission | Reason |
|------------|--------|
| `identity` | Authenticate you with your Google account via OAuth |
| `storage` | Store your session and search cache locally |
| `sidePanel` | Show the extension's UI in Chrome's side panel |
| `scripting` / `activeTab` | Scan the YouTube Music playlist page for unplayable tracks |
| `downloads` | Save the playlist backup file to your Downloads folder |
| `tabs` | Detect which tab is showing a YouTube Music playlist |
| `host: music.youtube.com/*` | Read and interact with YouTube Music playlist pages |
| `host: www.googleapis.com/*` | Call the YouTube Data API |

## Contact

This extension is an open-source school/personal project. For questions, open an issue on the project's GitHub repository.
