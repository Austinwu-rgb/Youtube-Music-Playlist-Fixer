// Backup the full playlist to a local JSON file before any edits.
// Ports backup_playlist from youtube_fix/playlist.py.
// Uses chrome.downloads.download with a Blob URL — no server needed.

import type { PlaylistItem } from './playlist.js'

export interface BackupPayload {
  playlistId: string
  backupDate: string
  itemCount: number
  items: PlaylistItem[]
}

/**
 * Download a JSON backup of all playlist items.
 * Called before the first replace in a session.
 * The user can use this to manually restore removed videos.
 */
export async function downloadBackup(
  playlistId: string,
  items: PlaylistItem[],
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  const payload: BackupPayload = {
    playlistId,
    backupDate: new Date().toISOString(),
    itemCount: items.length,
    items,
  }

  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const filename = `youtubereplacer-backup-${playlistId}-${date}.json`

  await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  })

  // Revoke after a short delay to ensure the download has started
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
