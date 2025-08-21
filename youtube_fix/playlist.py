from __future__ import annotations
from typing import Dict, Any, List, Tuple
import json, os, re, time
import os

YTM_OAUTH_FILE = os.getenv("YTMUSIC_OAUTH_PATH", "oauth.json")

# ------------------ Helpers ---------------------------------------------------

def _normalize_title(t: str) -> str:
    t = t.lower()
    # remove bracketed/parenthetical noise
    t = re.sub(r"\s*\[[^\]]+\]|\s*\([^)]+\)", " ", t)
    # common suffixes
    t = re.sub(r"\b(official|audio|video|lyrics|mv|hd|hq|remaster(ed)?)\b", " ", t)
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t

def _ensure_ytmusic_client():
    """
    Create a YTMusic client using:
      - oauth.json (created by `ytmusicapi oauth`)
      - OAuth client creds (TVs & Limited Input devices) from:
           env vars YTMUSIC_CLIENT_ID / YTMUSIC_CLIENT_SECRET
        or fallback file ytm_client.json:
           {"client_id": "...", "client_secret": "..."}
    """
    import os, json
    try:
        from ytmusicapi import YTMusic, OAuthCredentials
    except ImportError as e:
        raise RuntimeError("ytmusicapi not installed. Run: pip install ytmusicapi") from e

    # load .env if available
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass

    oauth_path = os.getenv("YTMUSIC_OAUTH_PATH", "oauth.json")
    if not os.path.exists(oauth_path):
        raise RuntimeError(
            f"{oauth_path} not found.\n"
            "Run the device OAuth once in your project root:\n"
            "  source .venv/Scripts/activate\n"
            "  python -m pip install -U ytmusicapi\n"
            "  ytmusicapi oauth\n"
            "This creates oauth.json. Keep it private and add it to .gitignore."
        )

    client_id = os.getenv("YTMUSIC_CLIENT_ID")
    client_secret = os.getenv("YTMUSIC_CLIENT_SECRET")

    if not client_id or not client_secret:
        # fallback: ytm_client.json next to oauth.json
        cfg_path = os.getenv("YTMUSIC_CLIENT_JSON", "ytm_client.json")
        if os.path.exists(cfg_path):
            with open(cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            client_id = data.get("client_id") or client_id
            client_secret = data.get("client_secret") or client_secret

    if not client_id or not client_secret:
        raise RuntimeError(
            "Missing YT Music OAuth client creds.\n"
            "Set them in .env (recommended):\n"
            "  YTMUSIC_CLIENT_ID=...   # TVs & Limited Input devices client\n"
            "  YTMUSIC_CLIENT_SECRET=...\n"
            "or create ytm_client.json with:\n"
            '  {"client_id":"...","client_secret":"..."}\n'
            "Then re-run."
        )

    print(f"DEBUG[ytmusic]: using {oauth_path} and TV/Device OAuth client from env/file")
    creds = OAuthCredentials(client_id=client_id, client_secret=client_secret)
    return YTMusic(oauth_path, oauth_credentials=creds)


# ------------------ YouTube Data API (official) ------------------------------

def list_playlist_items(youtube, playlist_id: str) -> List[Dict[str, Any]]:
    """Fetch all playlist items (50/page) with DEBUG lines."""
    items: List[Dict[str, Any]] = []
    token = None
    page = 0
    while True:
        page += 1
        t0 = time.time()
        resp = youtube.playlistItems().list(
            part="snippet,contentDetails,status",
            playlistId=playlist_id, maxResults=50, pageToken=token
        ).execute()
        batch = resp.get("items", [])
        items.extend(batch)
        token = resp.get("nextPageToken")
        print(f"DEBUG[list]: page={page} batch={len(batch)} t={time.time()-t0:.2f}s next={bool(token)}")
        if not token:
            break
    return items

def _videos_exist_batch(youtube, ids: List[str]) -> Dict[str, bool]:
    """Return dict videoId -> exists? (via videos.list)."""
    out: Dict[str, bool] = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i+50]
        t0 = time.time()
        resp = youtube.videos().list(part="id", id=",".join(chunk), maxResults=50).execute()
        present = {it["id"] for it in resp.get("items", [])}
        for vid in chunk:
            out[vid] = vid in present
        print(f"DEBUG[videos.exist]: batch={i//50+1} ids={len(chunk)} t={time.time()-t0:.2f}s present={len(present)}")
    return out

# ------------------ Music-only unavailability --------------------------------

def find_music_only_unavailable(
    youtube,
    items: List[Dict[str, Any]],
    playlist_id: str,
) -> List[Dict[str, Any]]:
    """
    Flag items that are UNAVAILABLE in YouTube Music but DO exist on regular YouTube.
    Strategy:
      1) Pull YT Music playlist, find tracks with isAvailable == False.
      2) Map those to your official playlistItems by videoId if possible; otherwise title-match fallback.
      3) For each mapped item, confirm the YouTube videoId actually exists via videos.list.
    """
    # Map videoId -> playlistItem
    id2item: Dict[str, Dict[str, Any]] = {}
    # Map normalized title -> list of playlistItems (for fallback)
    title_map: Dict[str, List[Dict[str, Any]]] = {}

    for it in items:
        vid = it.get("contentDetails", {}).get("videoId")
        title = (it.get("snippet", {}) or {}).get("title", "(no title)")
        if vid:
            id2item[vid] = it
        nt = _normalize_title(title)
        title_map.setdefault(nt, []).append(it)

    ytm = _ensure_ytmusic_client()
    t0 = time.time()
    pl = ytm.get_playlist(playlist_id, limit=10000)
    tracks = pl.get("tracks", [])
    print(f"DEBUG[ytmusic]: fetched {len(tracks)} tracks in {time.time()-t0:.2f}s")

    # 1) collect YTM-unavailable candidates
    candidates: List[Tuple[Dict[str, Any], str]] = []  # (playlistItem, map_reason)
    missing_vid_unavail_titles: List[str] = []

    for tr in tracks:
        is_avail = tr.get("isAvailable")
        if is_avail is not False:
            continue  # only care about not available in Music

        tr_title = tr.get("title") or ""
        tr_artists = tr.get("artists") or []
        artist0 = (tr_artists[0]["name"] if tr_artists else "")
        tr_vid = tr.get("videoId")  # may be None for unplayable tracks

        if tr_vid and tr_vid in id2item:
            # direct mapping by videoId
            candidates.append((id2item[tr_vid], "ytmusic:isAvailable=false (videoId match)"))
        else:
            # fallback: title-based approximate match to your list title
            key = _normalize_title(f"{tr_title} {artist0}")
            alt_key = _normalize_title(tr_title)
            matched = False
            for k in (key, alt_key):
                for it in title_map.get(k, []):
                    candidates.append((it, "ytmusic:isAvailable=false (title match)"))
                    matched = True
                    break
                if matched:
                    break
            if not matched:
                missing_vid_unavail_titles.append(f"{tr_title} — {artist0}")

    # Deduplicate by playlistItemId
    seen_pi = set()
    mapped_items: List[Tuple[Dict[str, Any], str]] = []
    for it, why in candidates:
        pi = it["id"]
        if pi not in seen_pi:
            seen_pi.add(pi)
            mapped_items.append((it, why))

    print(f"DEBUG[map]: ytm_unavailable candidates mapped → {len(mapped_items)} "
          f"(title-only unmatched={len(missing_vid_unavail_titles)})")

    # 2) Confirm they exist on YouTube (filter out truly deleted/private ones)
    vids = [it["contentDetails"]["videoId"] for it, _ in mapped_items if it["contentDetails"].get("videoId")]
    exists_map = _videos_exist_batch(youtube, vids) if vids else {}

    broken: List[Dict[str, Any]] = []
    for it, why in mapped_items:
        vid = it["contentDetails"].get("videoId")
        if not vid:
            # If no videoId we can’t prove existence; skip to avoid false positives
            print(f"DEBUG[skip]: no videoId on mapped item title={it['snippet'].get('title')!r}")
            continue
        if not exists_map.get(vid, False):
            # If the video doesn’t exist on YT, it’s not a Music-only mismatch; skip
            print(f"DEBUG[skip]: videoId {vid} does not exist on YouTube (not a Music-only case)")
            continue

        broken.append({
            "position": it["snippet"].get("position"),
            "title": it["snippet"].get("title", "(no title)"),
            "videoId": vid,
            "pi_id": it["id"],
            "reason": why,
        })

    print(f"DEBUG[result]: music_only_unavailable={len(broken)}")
    if missing_vid_unavail_titles:
        print("DEBUG[note]: Some YT Music-unavailable tracks had no clear mapping to playlist items:")
        for t in missing_vid_unavail_titles[:5]:
            print(f"   • {t}")
        if len(missing_vid_unavail_titles) > 5:
            print(f"   • (+{len(missing_vid_unavail_titles)-5} more)")

    return broken

# ------------------ Utilities -------------------------------------------------

def backup_playlist(items: List[Dict[str, Any]], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
