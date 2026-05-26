# Developer Setup Guide

## Prerequisites

- Node.js ≥ 18 (tested on 20.x)
- npm ≥ 9
- Chrome (Manifest V3 side panel requires Chrome 114+)
- A Google account that owns the playlists you want to fix
- YouTube Data API enabled in your Google Cloud project

---

## Step 1 — Build the extension

```powershell
# In the project root
npm install
npm run build
```

The compiled extension lands in `build/`.

---

## Step 2 — Pin the extension ID

Unpacked extensions get a **random ID** on each machine unless you pin it via a `key` in `manifest.json`. OAuth clients are bound to a specific extension ID, so you must pin it first.

**Important:** Do **not** put a fake placeholder in the `key` field. If `manifest.json` has an invalid `key`, **Pack extension** will fail with `Value 'key' is missing or invalid.` Leave the `key` field out until after your first pack (see below).

1. Run `npm run build` (the repo manifest has no `key` yet — that is correct).
2. Open `chrome://extensions` (or `edge://extensions`) → enable **Developer mode**.
3. Click **Pack extension**:
   - **Extension root directory:** your `build/` folder
   - **Private key file:** leave **empty** the first time
4. Click **Pack extension**. The browser creates `build.pem` (and `build.crx`) in your project folder.
5. Extract the **public** key (not the private key from the `.pem` file). From the project root:

```powershell
node -e "const c=require('crypto'),f=require('fs');const k=c.createPrivateKey(f.readFileSync('build.pem','utf8'));console.log(c.createPublicKey(k).export({type:'spki',format:'der'}).toString('base64'))"
```

The output should start with `MIIBIj...` (public key). If it starts with `MIIEvQ...`, that is the **private** key — do not put that in the manifest.

6. Open `extension/manifest.json` and add a `key` line **after** `"description"`:

```json
"key": "PASTE_THE_BASE64_STRING_HERE",
```

7. Re-run `npm run build`.
8. In `chrome://extensions` click **Load unpacked**, select `build/`. Note the **Extension ID** shown.

You will need this ID in Step 3. On future packs, select the same `build.pem` as the private key file so the ID stays the same.

---

## Step 3 — Create a Chrome Extension OAuth client

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) → project `youtubereplacer-469603`.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
3. **Application type: Chrome App** (the legacy name for Chrome Extension clients).
4. Enter the **Application ID** (Extension ID from Step 2, e.g. `abcdefghijklmnopabcdefghijklmnop`).
5. Click **Create**. Copy the **Client ID** (looks like `964446…-xxx.apps.googleusercontent.com`).
6. Open `extension/manifest.json` and replace `REPLACE_WITH_YOUR_CHROME_EXTENSION_CLIENT_ID` with your new Client ID.
7. Re-run `npm run build`.

> **Important:** Chrome Extension OAuth clients do **not** use a `client_secret`. Only the `client_id` is needed and it is safe to ship in the extension.

---

## Step 4 — Add test users to OAuth consent screen

Because the app is in **Testing** mode, only approved Google accounts can sign in.

1. **APIs & Services → OAuth consent screen**.
2. Scroll to **Test users → Add users**.
3. Add every Google account that needs to use the extension (e.g. `austinwu2019@gmail.com`, plus the Flowin Freeze account).
4. Save.

---

## Step 5 — Enable YouTube Data API v3

In the same Google Cloud project:

1. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.

(If it is already enabled, you can skip this.)

---

## Step 6 — Load and use the extension

1. Open `chrome://extensions`.
2. **Load unpacked** → select the `build/` folder.
3. Navigate to a playlist on **music.youtube.com**.
4. Click the extension icon in the toolbar. The side panel opens.
5. Click **Sign in with Google** and pick the account that owns the playlist.
6. Read and check the **Manual sort** acknowledgement (see below).
7. Click **Scan playlist**.

---

## Playlist Manual Sort requirement

YouTube Data API can only insert a video at a specific position when the playlist sort order is set to **Manual (Custom)**.

To set this in YouTube Music:

1. Open the playlist on `music.youtube.com`.
2. Click the three-dot menu at the top of the playlist → **Edit playlist**.
3. Under **Order**, select **Manual order**.
4. Save.

If you skip this step, the extension will still scan correctly, but the `insert` call will fail with a `manualSortRequired` error and the extension will show an actionable banner.

---

## Development (watch mode)

```powershell
npm run dev
```

Files in `extension/src/` are watched. After each rebuild, go to `chrome://extensions` and click the **reload** icon for the extension.

---

## Updating selectors after a YouTube Music UI change

YT Music occasionally updates its DOM structure. All selectors are in one file:

```
extension/src/lib/dom-selectors.ts
```

To diagnose a broken scan:

1. Open `music.youtube.com/playlist?list=YOUR_PL`.
2. Open DevTools → Console.
3. Run: `document.querySelectorAll('ytmusic-responsive-list-item-renderer')`
4. Inspect the returned elements. If the count is zero, the `row` selector needs updating.
5. Update `dom-selectors.ts`, rebuild, and reload the extension.

---

## Adding extension icons

The extension currently has no icons. Add them to `extension/icons/`:

- `icon-16.png` — 16×16 px
- `icon-48.png` — 48×48 px
- `icon-128.png` — 128×128 px

Then re-enable the `icons` and `action.default_icon` fields in `extension/manifest.json` by adding:

```json
"action": {
  "default_title": "YouTube Music Replacer",
  "default_icon": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
},
"icons": {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
}
```

Rebuild after adding the PNG files.
