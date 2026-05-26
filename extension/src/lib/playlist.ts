// YouTube Data API playlist operations.
// Ports list_playlist_items and builds the videoId → PlaylistItem map.

import { apiFetch, YouTubeApiError } from './youtube-api.js'
import { recordUnits } from './quota.js'

export interface PlaylistItem {
  piId: string
  videoId: string
  position: number
  title: string
  channelTitle: string
}

interface YtPlaylistItemsResponse {
  items?: {
    id: string
    snippet: {
      position: number
      title: string
      videoOwnerChannelTitle?: string
      resourceId: { videoId: string }
    }
  }[]
  nextPageToken?: string
}

/** Paginate through all items in a playlist (50/page). Returns full list. */
export async function listPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = []
  let pageToken: string | undefined

  do {
    const params: Record<string, string> = {
      part: 'snippet',
      playlistId,
      maxResults: '50',
    }
    if (pageToken) params['pageToken'] = pageToken

    const resp = (await apiFetch('playlistItems', params)) as YtPlaylistItemsResponse
    await recordUnits(1)

    for (const it of resp.items ?? []) {
      items.push({
        piId: it.id,
        videoId: it.snippet.resourceId.videoId,
        position: it.snippet.position,
        title: it.snippet.title,
        channelTitle: it.snippet.videoOwnerChannelTitle ?? '',
      })
    }

    pageToken = resp.nextPageToken
  } while (pageToken)

  return items
}

/** Build a map from videoId → PlaylistItem. Useful for O(1) lookup. */
export function buildVideoIdMap(items: PlaylistItem[]): Map<string, PlaylistItem> {
  const map = new Map<string, PlaylistItem>()
  for (const item of items) {
    map.set(item.videoId, item)
  }
  return map
}

/**
 * Re-fetch a single item's current position by videoId (cheap: 1 unit).
 * Positions shift after prior replacements, so always call this right before insert.
 */
export async function fetchCurrentPosition(
  playlistId: string,
  videoId: string,
): Promise<{ piId: string; position: number } | null> {
  const params: Record<string, string> = {
    part: 'snippet',
    playlistId,
    videoId,
    maxResults: '5',
  }
  const resp = (await apiFetch('playlistItems', params)) as YtPlaylistItemsResponse
  await recordUnits(1)
  const first = resp.items?.[0]
  if (!first) return null
  return { piId: first.id, position: first.snippet.position }
}

/** Verify that a playlist is owned by the given channelId. */
export async function verifyPlaylistOwnership(
  playlistId: string,
  myChannelId: string,
): Promise<boolean> {
  const resp = (await apiFetch('playlists', {
    part: 'snippet',
    id: playlistId,
    maxResults: '1',
  })) as { items?: { snippet: { channelId: string } }[] }
  await recordUnits(1)
  const channelId = resp.items?.[0]?.snippet.channelId
  return channelId === myChannelId
}

/**
 * Batch-check which videoIds exist on regular YouTube (videos.list).
 * Returns a Set of existing videoIds.
 * Cross-check gate: a track must exist on YouTube to be a Music-only issue.
 */
export async function batchCheckVideoExists(videoIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>()
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50)
    const resp = (await apiFetch('videos', {
      part: 'id',
      id: chunk.join(','),
      maxResults: '50',
    })) as { items?: { id: string }[] }
    await recordUnits(1)
    for (const it of resp.items ?? []) {
      existing.add(it.id)
    }
  }
  return existing
}

/** Get the authenticated user's channel ID and display name. */
export async function getMyChannel(): Promise<{ channelId: string; title: string }> {
  const resp = (await apiFetch('channels', {
    part: 'snippet',
    mine: 'true',
    maxResults: '1',
  })) as { items?: { id: string; snippet: { title: string } }[] }
  await recordUnits(1)
  const item = resp.items?.[0]
  if (!item) throw new Error('No channel found for signed-in account')
  return { channelId: item.id, title: item.snippet.title }
}

export { YouTubeApiError }
