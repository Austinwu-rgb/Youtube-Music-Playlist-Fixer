from __future__ import annotations
import argparse, datetime as dt, sys
from youtube_fix.auth import get_service
from youtube_fix.playlist import list_playlist_items, is_unavailable, backup_playlist
from youtube_fix.search import search_candidates, rank_candidates
from youtube_fix.replace import insert_at, delete_item

def scan(youtube, playlist_id: str):
    items = list_playlist_items(youtube, playlist_id)
    broken = []
    for it in items:
        vid = it["contentDetails"]["videoId"]
        title = it["snippet"].get("title","(no title)")
        pos = it["snippet"].get("position")
        if is_unavailable(youtube, vid):
            broken.append({"position": pos, "title": title, "videoId": vid, "pi_id": it["id"]})
    return items, broken

def choose_replacement(youtube, title: str) -> str | None:
    cands = search_candidates(youtube, title)
    ranked = rank_candidates(youtube, cands)
    return ranked[0][0] if ranked else None

def main():
    ap = argparse.ArgumentParser(description="Fix unavailable YouTube playlist items.")
    ap.add_argument("--playlist", "-p", required=True, help="Playlist ID (the value after list=)")
    ap.add_argument("--apply", action="store_true", help="Actually modify the playlist (default: dry-run)")
    ap.add_argument("--max", type=int, default=5, help="Max broken items to attempt")
    ap.add_argument("--keep-broken", action="store_true", help="Do not delete broken items (insert only)")
    args = ap.parse_args()

    yt = get_service()
    items, broken = scan(yt, args.playlist)

    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_playlist(items, f"backup/{args.playlist}_{ts}.json")
    print(f"Playlist items: {len(items)} | Broken: {len(broken)}")
    if not broken:
        print("No unavailable items found.")
        return 0

    count = 0
    for b in broken:
        if count >= args.max: break
        pos, title, pi_id = b["position"], b["title"], b["pi_id"]
        print(f"\n[#{count+1}] pos={pos} title={title!r}")
        new_vid = choose_replacement(yt, title)
        if not new_vid:
            print("  No candidates found.")
            continue

        print(f"  Candidate → {new_vid}")
        if args.apply:
            try:
                insert_at(yt, args.playlist, new_vid, position=pos)
                print("  Inserted.")
                if not args.keep_broken:
                    delete_item(yt, pi_id)
                    print("  Deleted broken item.")
            except Exception as e:
                print("  Insert failed. Tip: set playlist to Custom/Manual order if position is rejected.")
                print(f"  Error: {e}")
        else:
            print("  DRY-RUN: would insert at same position; then delete broken.")
        count += 1

    print("\nDone.")
    if not args.apply:
        print("Run again with --apply to make changes.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
