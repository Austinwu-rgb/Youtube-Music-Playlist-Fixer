from __future__ import annotations
from typing import List, Tuple, Dict, Any
import json, os, re

CACHE_FILE = os.path.join("cache", "search_cache.json")

def _load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def _save_cache(d):
    os.makedirs("cache", exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)

def normalize_title(t: str) -> str:
    t = re.sub(r"\s*\[[^\]]+\]|\s*\([^)]+\)", "", t)             # drop brackets
    t = re.sub(r"(?i)\b(official|audio|video|lyrics|mv)\b", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t

def search_candidates(youtube, title: str, max_results: int = 8) -> List[str]:
    cache = _load_cache()
    key = f"{title}|{max_results}"
    if key in cache: return cache[key]

    q = f"{normalize_title(title)} official"
    resp = youtube.search().list(
        part="snippet", q=q, type="video", maxResults=max_results
    ).execute()
    vids = [it["id"]["videoId"] for it in resp.get("items", [])]

    cache[key] = vids
    _save_cache(cache)
    return vids

def rank_candidates(youtube, candidate_ids: List[str]) -> List[Tuple[str, int]]:
    """
    Return list of (videoId, score) higher is better.
    Very simple: prefer Official Artist Channel / Topic and shorter titles.
    """
    if not candidate_ids: return []
    resp = youtube.videos().list(
        part="snippet,contentDetails",
        id=",".join(candidate_ids)
    ).execute()
    out: List[Tuple[str,int]] = []
    for it in resp.get("items", []):
        vid = it["id"]
        sn = it["snippet"]
        title = sn.get("title","").lower()
        ch_title = sn.get("channelTitle","").lower()

        score = 0
        if "official" in title: score += 4
        if "topic" in ch_title:  score += 3
        if "official artist channel" in ch_title: score += 5
        # bias against lyric/extended
        if "lyric" in title: score -= 1
        if "extended" in title: score -= 1
        # shorter title slightly preferred
        score += max(0, 30 - len(title)) // 10

        out.append((vid, score))
    out.sort(key=lambda x: x[1], reverse=True)
    return out
