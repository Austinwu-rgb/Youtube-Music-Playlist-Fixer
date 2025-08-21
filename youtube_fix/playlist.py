from __future__ import annotations
from typing import Dict, Any, List

def list_playlist_items(youtube, playlist_id: str) -> List[Dict[str, Any]]:
    items, token = [], None
    while True:
        resp = youtube.playlistItems().list(
            part="snippet,contentDetails,status",
            playlistId=playlist_id, maxResults=50, pageToken=token
        ).execute()
        items.extend(resp.get("items", []))
        token = resp.get("nextPageToken")
        if not token: break
    return items

def video_exists(youtube, video_id: str) -> bool:
    resp = youtube.videos().list(
        part="status,contentDetails,snippet", id=video_id
    ).execute()
    return len(resp.get("items", [])) > 0

def is_unavailable(youtube, video_id: str) -> bool:
    return not video_exists(youtube, video_id)

def backup_playlist(items: List[Dict[str, Any]], path: str) -> None:
    import json, os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
