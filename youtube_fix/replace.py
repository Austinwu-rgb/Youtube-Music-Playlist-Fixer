from __future__ import annotations

def insert_at(youtube, playlist_id: str, video_id: str, position: int | None):
    body = {
        "snippet": {
            "playlistId": playlist_id,
            "resourceId": {"kind": "youtube#video", "videoId": video_id},
        }
    }
    if position is not None:
        body["snippet"]["position"] = position
    return youtube.playlistItems().insert(part="snippet", body=body).execute()

def delete_item(youtube, playlist_item_id: str):
    return youtube.playlistItems().delete(id=playlist_item_id).execute()
