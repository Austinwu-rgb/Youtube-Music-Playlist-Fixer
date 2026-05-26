// Typed message protocol for all chrome.runtime.sendMessage calls across
// service-worker, content script, and side panel.

export interface BrokenTrack {
  videoId: string
  title: string
  channelTitle: string
  position: number
  piId: string
}

export interface CandidateVideo {
  videoId: string
  title: string
  channelTitle: string
  thumbnailUrl: string
  durationSec: number
  score: number
}

export type AppMsg =
  // Side panel → service worker
  | { type: 'GET_STATE' }
  | { type: 'SIGN_IN' }
  | { type: 'SIGN_OUT' }
  | { type: 'START_SCAN' }
  | { type: 'CANCEL_SCAN' }
  | { type: 'REQUEST_CANDIDATES'; title: string; videoId: string }
  | { type: 'CONFIRM_REPLACE'; piId: string; newVideoId: string; title: string }
  | { type: 'SKIP_TRACK' }
  | { type: 'STOP_FIXING' }
  | { type: 'BACK_FROM_FIXING' }
  | { type: 'RESCAN' }
  | { type: 'EXPORT_LOG' }
  | { type: 'DOWNLOAD_BACKUP' }
  | { type: 'ACK_MANUAL_SORT' }

  // Content script → service worker
  | { type: 'PAGE_INFO'; playlistId: string | null; onPlaylistPage: boolean }
  | { type: 'SCAN_PROGRESS'; scanned: number; foundBroken: number }
  | { type: 'SCAN_DONE'; rows: ScannedRow[] }

  // Service worker → content script
  | { type: 'DO_SCAN'; playlistId: string }
  | { type: 'CANCEL_SCAN_CS' }
  | { type: 'SCROLL_TO'; videoId: string; title?: string }
  | { type: 'CLEAR_HIGHLIGHT' }

  // Service worker → side panel (via storage events or direct message)
  | { type: 'STATE_UPDATE' }
  | { type: 'CANDIDATES_READY'; candidates: CandidateVideo[] }
  | { type: 'REPLACE_RESULT'; ok: boolean; errorCode?: string; message?: string }

export interface ScannedRow {
  key: string
  videoId: string | null
  title: string
  channelTitle: string
  isUnplayable: boolean
}

export type MsgResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string }
