// Ports search_candidates and rank_candidates from youtube_fix/search.py.
// Results are cached in chrome.storage.local to avoid burning quota on retries.

import { apiFetch } from './youtube-api.js'
import { normalizeTitle } from './normalize-title.js'
import { recordUnits } from './quota.js'
import type { CandidateVideo } from './messages.js'

const CACHE_KEY_PREFIX = 'ytmr_search_'
const MAX_CACHE_ENTRIES = 200
const DEFAULT_MAX_RESULTS = 8

interface CacheEntry {
  videoIds: string[]
  ts: number
}

function cacheKey(title: string, maxResults: number): string {
  return `${CACHE_KEY_PREFIX}${normalizeTitle(title)}|${maxResults}`
}

async function loadCache(key: string): Promise<string[] | null> {
  const result = await chrome.storage.local.get(key) as Record<string, CacheEntry | undefined>
  const entry = result[key]
  if (!entry) return null
  // Expire after 24h
  if (Date.now() - entry.ts > 86_400_000) return null
  return entry.videoIds
}

async function saveCache(key: string, videoIds: string[]): Promise<void> {
  await chrome.storage.local.set({ [key]: { videoIds, ts: Date.now() } as CacheEntry })
}

/** Search YouTube for videos matching title. Returns list of videoIds. */
async function searchCandidateIds(
  title: string,
  maxResults = DEFAULT_MAX_RESULTS,
): Promise<string[]> {
  const key = cacheKey(title, maxResults)
  const cached = await loadCache(key)
  if (cached) return cached

  const q = `${normalizeTitle(title)} official`
  const resp = (await apiFetch('search', {
    part: 'snippet',
    q,
    type: 'video',
    maxResults: String(maxResults),
    videoCategoryId: '10', // Music category
  })) as { items?: { id: { videoId: string } }[] }
  await recordUnits(100)

  const ids = (resp.items ?? []).map((it) => it.id.videoId)
  await saveCache(key, ids)
  return ids
}

/** Fetch metadata for candidate videoIds and rank them. */
async function rankCandidates(videoIds: string[]): Promise<CandidateVideo[]> {
  if (videoIds.length === 0) return []

  const resp = (await apiFetch('videos', {
    part: 'snippet,contentDetails',
    id: videoIds.join(','),
    maxResults: String(videoIds.length),
  })) as {
    items?: {
      id: string
      snippet: {
        title: string
        channelTitle: string
        thumbnails: { default?: { url: string }; medium?: { url: string } }
      }
      contentDetails: { duration: string }
    }[]
  }
  await recordUnits(1)

  const candidates: CandidateVideo[] = []

  for (const it of resp.items ?? []) {
    const title = it.snippet.title.toLowerCase()
    const ch = it.snippet.channelTitle.toLowerCase()

    let score = 0
    if (title.includes('official')) score += 4
    if (ch.includes('topic')) score += 3
    if (ch.includes('official artist channel')) score += 5
    if (title.includes('lyric')) score -= 1
    if (title.includes('extended')) score -= 1
    score += Math.max(0, Math.floor((30 - title.length) / 10))

    const durationSec = isoDurationToSec(it.contentDetails.duration)
    const thumbnailUrl =
      it.snippet.thumbnails.medium?.url ??
      it.snippet.thumbnails.default?.url ??
      ''

    candidates.push({
      videoId: it.id,
      title: it.snippet.title,
      channelTitle: it.snippet.channelTitle,
      thumbnailUrl,
      durationSec,
      score,
    })
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates
}

/** Full search + rank pipeline. Returns sorted candidates. */
export async function searchAndRank(
  title: string,
  maxResults = DEFAULT_MAX_RESULTS,
): Promise<CandidateVideo[]> {
  const ids = await searchCandidateIds(title, maxResults)
  return rankCandidates(ids)
}

/** Parse ISO 8601 duration (PT3M45S) to seconds. */
function isoDurationToSec(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (
    parseInt(m[1] ?? '0') * 3600 +
    parseInt(m[2] ?? '0') * 60 +
    parseInt(m[3] ?? '0')
  )
}

/** Format seconds as m:ss */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
