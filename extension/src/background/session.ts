// Persisted session state in chrome.storage.session.
// MV3 service workers terminate after ~30s idle; all mutable state lives here.

import type { BrokenTrack, CandidateVideo, FixedTrackRef } from '../lib/messages.js'

export type AppState =
  | { view: 'signed-out' }
  | { view: 'needs-playlist'; channelId: string; channelTitle: string }
  | {
      view: 'ready'
      channelId: string
      channelTitle: string
      playlistId: string
      manualSortAcked: boolean
    }
  | {
      view: 'scanning'
      channelId: string
      channelTitle: string
      playlistId: string
      scanned: number
      foundBroken: number
    }
  | {
      view: 'reviewing'
      channelId: string
      channelTitle: string
      playlistId: string
      broken: BrokenTrack[]
      currentIndex: number
      fixed: number
      skipped: number
      errored: number
      backupDone: boolean
      log: SessionLogEntry[]
    }
  | {
      view: 'fixing'
      channelId: string
      channelTitle: string
      playlistId: string
      broken: BrokenTrack[]
      currentIndex: number
      fixed: number
      skipped: number
      errored: number
      backupDone: boolean
      log: SessionLogEntry[]
      candidates: CandidateVideo[]
      searchQuery: string
    }
  | {
      view: 'reviewing-fixes'
      channelId: string
      channelTitle: string
      playlistId: string
      fixedTracks: FixedTrackRef[]
      currentReviewIndex: number
      fixed: number
      skipped: number
      errored: number
      log: SessionLogEntry[]
    }
  | {
      view: 'done'
      channelId: string
      channelTitle: string
      playlistId: string
      fixed: number
      skipped: number
      errored: number
      log: SessionLogEntry[]
      scannedTotal: number
      noBrokenFound: boolean
      scanIncomplete?: boolean
    }

export interface SessionLogEntry {
  action: 'fixed' | 'skipped' | 'errored'
  originalTitle: string
  originalVideoId: string
  replacementVideoId?: string
  replacementTitle?: string
  position: number
  error?: string
  timestamp: string
}

const STORAGE_KEY = 'ytmr_session'

export async function loadSession(): Promise<AppState> {
  const result = await chrome.storage.session.get(STORAGE_KEY) as Record<string, AppState | undefined>
  return result[STORAGE_KEY] ?? { view: 'signed-out' }
}

export async function saveSession(state: AppState): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: state })
  // Notify side panel (if open) that state has changed
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE' }).catch(() => {
    // Side panel may not be open — ignore
  })
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEY)
}
