// Ports insert_at and delete_item from youtube_fix/replace.py.
// Both go through apiFetch which handles token refresh.

import { apiFetch } from './youtube-api.js'
import { recordUnits } from './quota.js'

/**
 * Insert a video into a playlist at a specific 0-based position.
 * The video at that position shifts down. Returns the new playlistItemId.
 */
export async function insertAt(
  playlistId: string,
  videoId: string,
  position: number,
): Promise<string> {
  const body = {
    snippet: {
      playlistId,
      position,
      resourceId: {
        kind: 'youtube#video',
        videoId,
      },
    },
  }
  const resp = (await apiFetch('playlistItems', { part: 'snippet' }, 'POST', body)) as {
    id: string
  }
  await recordUnits(50)
  return resp.id
}

/**
 * Delete a playlist item by its playlistItemId (not by videoId or position).
 * Using piId avoids off-by-one issues after prior insertions.
 */
export async function deleteItem(piId: string): Promise<void> {
  await apiFetch('playlistItems', { id: piId }, 'DELETE')
  await recordUnits(50)
}
