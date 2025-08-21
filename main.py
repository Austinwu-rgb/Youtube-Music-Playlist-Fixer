from __future__ import annotations
import argparse, datetime as dt, sys, time
from googleapiclient.errors import HttpError

from youtube_fix.auth import get_service
from youtube_fix.playlist import (
    list_playlist_items,
    find_music_only_unavailable,  # <-- NEW core detector
    backup_playlist,
)
from youtube_fix.search import search_candidates, rank_candidates
from youtube_fix.replace import insert_at, delete_item


def choose_replacement(youtube, title: str) -> str | None:
    # Simple heuristic: search and choose the top-ranked candidate
    cands = search_candidates(youtube, title)
    ranked = rank_candidates(youtube, cands)
    return ranked[0][0] if ranked else None


def scan_music_only(youtube, playlist_id: str):
    """
    Detect items that exist on YouTube (videoId resolves) but are UNAVAILABLE on YouTube Music.
    """
    t0 = time.time()
    print(f"DEBUG: listing playlist items for {playlist_id!r} …")
    items = list_playlist_items(youtube, playlist_id)
    print(f"DEBUG: list complete in {time.time()-t0:.2f}s; items={len(items)}")

    t1 = time.time()
    print("DEBUG: calling YT Music to find Music-unavailable tracks (OAuth may open browser on first run) …")
    broken = find_music_only_unavailable(youtube, items, playlist_id)
    print(f"DEBUG: YT Music overlay finished in {time.time()-t1:.2f}s; music_only_broken={len(broken)}")
    return items, broken


def main():
    ap = argparse.ArgumentParser(description="Fix items that are available on YouTube but unavailable on YouTube Music.")
    ap.add_argument("--playlist", "-p", required=True, help="Playlist ID (value after list=)")
    ap.add_argument("--apply", action="store_true", help="Actually modify the playlist (default: dry-run)")
    ap.add_argument("--max", type=int, default=5, help="Max items to attempt")
    ap.add_argument("--keep-broken", action="store_true", help="Do not delete the original item (insert only)")
    args = ap.parse_args()

    print("DEBUG: authenticating YouTube Data API …")
    t0 = time.time()
    yt = get_service()
    print(f"DEBUG: auth done in {time.time()-t0:.2f}s")

    items, broken = scan_music_only(yt, args.playlist)

    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"backup/{args.playlist}_{ts}.json"
    backup_playlist(items, backup_path)
    print(f"DEBUG: backup saved → {backup_path}")

    print(f"SUMMARY: items={len(items)} | music_only_unavailable={len(broken)}")
    if not broken:
        print("No Music-only unavailable items found.")
        return 0

    count = 0
    for b in broken:
        if count >= args.max:
            print(f"DEBUG: reached --max={args.max}; stopping.")
            break

        pos, title, pi_id = b["position"], b["title"], b["pi_id"]
        vid = b["videoId"]
        reason = b.get("reason", "ytmusic:isAvailable=false")
        print(f"\n[#{count+1}] pos={pos} title={title!r} (videoId={vid}) reason={reason}")

        new_vid = choose_replacement(yt, title)
        if not new_vid:
            print("  No replacement candidates found for this title.")
            continue

        print(f"  Replacement choice → {new_vid}")
        if args.apply:
            try:
                t_ins = time.time()
                insert_at(yt, args.playlist, new_vid, position=pos)
                print(f"  Inserted at pos={pos} in {time.time()-t_ins:.2f}s")
                if not args.keep_broken:
                    t_del = time.time()
                    delete_item(yt, pi_id)
                    print(f"  Deleted original item (playlistItemId={pi_id}) in {time.time()-t_del:.2f}s")
            except HttpError as e:
                print("  ERROR: API refused the change.")
                print("   • Ensure playlist sorting is Custom (Manual) in the YouTube UI.")
                print("   • If scopes changed, delete token.json and re-auth.")
                print(f"   • Raw error: {e}")
            except Exception as e:
                print(f"  Unexpected error: {type(e).__name__}: {e}")
        else:
            print("  DRY-RUN: would insert at same position; then delete original (unless --keep-broken).")

        count += 1

    print("\nDone.")
    if not args.apply:
        print("Run again with --apply to make changes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
