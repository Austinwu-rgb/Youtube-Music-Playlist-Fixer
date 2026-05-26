// MV3 Service Worker — message router, auth, and API orchestration.
// All YouTube Data API calls live here.
// State is persisted to chrome.storage.session after every mutation so that
// worker restarts don't lose progress.

import { getToken, signOut as authSignOut } from '../lib/auth.js'
import {
  getMyChannel,
  listPlaylistItems,
  buildVideoIdMap,
  batchCheckVideoExists,
  fetchCurrentPosition,
  verifyPlaylistOwnership,
} from '../lib/playlist.js'
import { searchAndRank } from '../lib/search.js'
import { insertAt, deleteItem } from '../lib/replace.js'
import { downloadBackup } from '../lib/backup.js'
import { getQuotaStatus } from '../lib/quota.js'
import { loadSession, saveSession, clearSession, type AppState, type SessionLogEntry } from './session.js'
import type { AppMsg, BrokenTrack, ScannedRow } from '../lib/messages.js'

// ── Action: open side panel when the toolbar icon is clicked ────────────────
chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
  }
})

// ── Main message router ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg: AppMsg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }))
  return true // keep channel open for async response
})

async function handleMessage(msg: AppMsg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'GET_STATE':
      return loadSession()

    case 'SIGN_IN':
      return handleSignIn()

    case 'SIGN_OUT':
      return handleSignOut()

    case 'PAGE_INFO':
      return handlePageInfo(msg.playlistId, msg.onPlaylistPage)

    case 'START_SCAN':
      return handleStartScan()

    case 'CANCEL_SCAN':
      return handleCancelScan()

    case 'SCAN_PROGRESS':
      return handleScanProgress(msg.scanned, msg.foundBroken)

    case 'SCAN_DONE':
      return handleScanDone(msg.rows)

    case 'REQUEST_CANDIDATES':
      return handleRequestCandidates(msg.title, msg.videoId)

    case 'CONFIRM_REPLACE':
      return handleConfirmReplace(msg.piId, msg.newVideoId, msg.title)

    case 'SKIP_TRACK':
      return handleSkipTrack()

    case 'STOP_FIXING':
      return handleStopFixing()

    case 'BACK_FROM_FIXING':
      return handleBackFromFixing()

    case 'RESCAN':
      return handleRescan()

    case 'EXPORT_LOG':
      return handleExportLog()

    case 'DOWNLOAD_BACKUP':
      return handleDownloadBackup()

    case 'ACK_MANUAL_SORT':
      return handleAckManualSort()

    default:
      throw new Error(`Unknown message type: ${(msg as { type: string }).type}`)
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleSignIn(): Promise<void> {
  await getToken(true)
  const { channelId, title } = await getMyChannel()
  const state = await loadSession()
  if (state.view === 'signed-out') {
    await saveSession({ view: 'needs-playlist', channelId, channelTitle: title })
  }
}

async function handleSignOut(): Promise<void> {
  await authSignOut()
  await clearSession()
  await saveSession({ view: 'signed-out' })
}

async function handlePageInfo(
  playlistId: string | null,
  onPlaylistPage: boolean,
): Promise<void> {
  const state = await loadSession()
  if (state.view === 'signed-out') return

  if (!onPlaylistPage || !playlistId) {
    if (
      state.view === 'ready' ||
      state.view === 'reviewing' ||
      state.view === 'fixing' ||
      state.view === 'done' ||
      state.view === 'scanning'
    ) {
      await saveSession({
        view: 'needs-playlist',
        channelId: state.channelId,
        channelTitle: state.channelTitle,
      })
    }
    return
  }

  const channelId = 'channelId' in state ? state.channelId : ''
  const channelTitle = 'channelTitle' in state ? state.channelTitle : ''

  // Check ownership
  let owned = false
  try {
    owned = await verifyPlaylistOwnership(playlistId, channelId)
  } catch {
    owned = false
  }

  if (!owned) {
    await saveSession({
      view: 'ready',
      channelId,
      channelTitle,
      playlistId,
      manualSortAcked: false,
    })
    // Will show ownership error in side panel via state
    return
  }

  if (state.view === 'needs-playlist' || state.view === 'signed-out') {
    await saveSession({
      view: 'ready',
      channelId,
      channelTitle,
      playlistId,
      manualSortAcked: false,
    })
  }
}

async function handleStartScan(): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'ready') throw new Error('Not in ready state')
  if (!state.manualSortAcked) throw new Error('Please acknowledge the Manual sort requirement first')

  await saveSession({
    view: 'scanning',
    channelId: state.channelId,
    channelTitle: state.channelTitle,
    playlistId: state.playlistId,
    scanned: 0,
    foundBroken: 0,
  })

  // Tell content script to start the DOM scan
  const tab = await getActiveTab()
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'DO_SCAN', playlistId: state.playlistId })
  }
}

async function handleCancelScan(): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'scanning') return
  const tab = await getActiveTab()
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'CANCEL_SCAN_CS' }).catch(() => {})
  }
  await saveSession({
    view: 'ready',
    channelId: state.channelId,
    channelTitle: state.channelTitle,
    playlistId: state.playlistId,
    manualSortAcked: true,
  })
}

async function handleScanProgress(scanned: number, foundBroken: number): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'scanning') return
  await saveSession({ ...state, scanned, foundBroken })
}

async function handleScanDone(rows: ScannedRow[]): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'scanning') return

  const unplayable = rows.filter((r) => r.isUnplayable)

  // Fetch playlist items from API to get piId + position
  const apiItems = await listPlaylistItems(state.playlistId)
  const vidMap = buildVideoIdMap(apiItems)

  // Cross-check: only keep items that exist on regular YouTube
  const videoIds = unplayable.map((r) => r.videoId).filter(Boolean) as string[]
  const existing = await batchCheckVideoExists(videoIds)

  const broken: BrokenTrack[] = []
  for (const row of unplayable) {
    if (!row.videoId || !existing.has(row.videoId)) continue
    const apiItem = vidMap.get(row.videoId)
    if (!apiItem) continue
    broken.push({
      videoId: row.videoId,
      title: row.title || apiItem.title,
      channelTitle: row.channelTitle || apiItem.channelTitle,
      position: apiItem.position,
      piId: apiItem.piId,
    })
  }

  if (broken.length === 0) {
    await saveSession({
      view: 'done',
      channelId: state.channelId,
      channelTitle: state.channelTitle,
      playlistId: state.playlistId,
      fixed: 0,
      skipped: 0,
      errored: 0,
      log: [],
    })
    return
  }

  await saveSession({
    view: 'reviewing',
    channelId: state.channelId,
    channelTitle: state.channelTitle,
    playlistId: state.playlistId,
    broken,
    currentIndex: 0,
    fixed: 0,
    skipped: 0,
    errored: 0,
    backupDone: false,
    log: [],
  })

  // Scroll to first broken track
  const first = broken[0]
  if (first) await scrollToTrack(first.videoId)
}

async function handleRequestCandidates(title: string, videoId: string): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'reviewing') throw new Error('Not in reviewing state')

  const candidates = await searchAndRank(title)

  await saveSession({
    view: 'fixing',
    channelId: state.channelId,
    channelTitle: state.channelTitle,
    playlistId: state.playlistId,
    broken: state.broken,
    currentIndex: state.currentIndex,
    fixed: state.fixed,
    skipped: state.skipped,
    errored: state.errored,
    backupDone: state.backupDone,
    log: state.log,
    candidates,
    searchQuery: title,
  })

  // Scroll to track while the candidate list loads
  await scrollToTrack(videoId)
}

async function handleConfirmReplace(
  piId: string,
  newVideoId: string,
  originalTitle: string,
): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'fixing') throw new Error('Not in fixing state')

  const current = state.broken[state.currentIndex]
  if (!current) throw new Error('No current track')

  let newPiId: string | undefined
  const logEntry: SessionLogEntry = {
    action: 'fixed',
    originalTitle: current.title,
    originalVideoId: current.videoId,
    position: current.position,
    timestamp: new Date().toISOString(),
  }

  try {
    // Back up before first edit
    if (!state.backupDone) {
      const allItems = await listPlaylistItems(state.playlistId)
      await downloadBackup(state.playlistId, allItems)
    }

    // Re-fetch current position (may have shifted from prior replacements)
    const fresh = await fetchCurrentPosition(state.playlistId, current.videoId)
    const position = fresh?.position ?? current.position
    const freshPiId = fresh?.piId ?? piId

    // Insert replacement at same position, then delete original
    newPiId = await insertAt(state.playlistId, newVideoId, position)
    await deleteItem(freshPiId)

    const candidateInfo = state.candidates.find((c) => c.videoId === newVideoId)
    logEntry.replacementVideoId = newVideoId
    logEntry.replacementTitle = candidateInfo?.title ?? newVideoId
  } catch (err) {
    const error = err as Error
    logEntry.action = 'errored'
    logEntry.error = error.message

    const nextIndex = state.currentIndex + 1
    const hasMore = nextIndex < state.broken.length

    await saveSession({
      view: hasMore ? 'reviewing' : 'done',
      channelId: state.channelId,
      channelTitle: state.channelTitle,
      playlistId: state.playlistId,
      ...(hasMore
        ? {
            broken: state.broken,
            currentIndex: nextIndex,
            fixed: state.fixed,
            skipped: state.skipped,
            errored: state.errored + 1,
            backupDone: true,
          }
        : {
            fixed: state.fixed,
            skipped: state.skipped,
            errored: state.errored + 1,
            log: [...state.log, logEntry],
          }),
    } as AppState)

    throw error
  }

  const nextIndex = state.currentIndex + 1
  const hasMore = nextIndex < state.broken.length

  const updatedLog = [...state.log, logEntry]
  const baseNext = {
    channelId: state.channelId,
    channelTitle: state.channelTitle,
    playlistId: state.playlistId,
    fixed: state.fixed + 1,
    skipped: state.skipped,
    errored: state.errored,
    backupDone: true,
    log: updatedLog,
  }

  if (hasMore) {
    await saveSession({
      view: 'reviewing',
      ...baseNext,
      broken: state.broken,
      currentIndex: nextIndex,
    })
    const next = state.broken[nextIndex]
    if (next) await scrollToTrack(next.videoId)
  } else {
    await saveSession({
      view: 'done',
      ...baseNext,
    })
    await clearHighlight()
  }
}

async function handleSkipTrack(): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'reviewing' && state.view !== 'fixing') {
    throw new Error('Not in reviewing/fixing state')
  }

  const nextIndex = state.currentIndex + 1
  const hasMore = nextIndex < state.broken.length

  if (hasMore) {
    await saveSession({
      view: 'reviewing',
      channelId: state.channelId,
      channelTitle: state.channelTitle,
      playlistId: state.playlistId,
      broken: state.broken,
      currentIndex: nextIndex,
      fixed: state.fixed,
      skipped: state.skipped + 1,
      errored: state.errored,
      backupDone: state.backupDone,
      log: state.log,
    })
    const next = state.broken[nextIndex]
    if (next) await scrollToTrack(next.videoId)
  } else {
    await saveSession({
      view: 'done',
      channelId: state.channelId,
      channelTitle: state.channelTitle,
      playlistId: state.playlistId,
      fixed: state.fixed,
      skipped: state.skipped + 1,
      errored: state.errored,
      log: state.log,
    })
    await clearHighlight()
  }
}

async function handleBackFromFixing(): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'fixing') return
  await saveSession({
    view: 'reviewing',
    channelId: state.channelId,
    channelTitle: state.channelTitle,
    playlistId: state.playlistId,
    broken: state.broken,
    currentIndex: state.currentIndex,
    fixed: state.fixed,
    skipped: state.skipped,
    errored: state.errored,
    backupDone: state.backupDone,
    log: state.log,
  })
}

async function handleAckManualSort(): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'ready') return
  await saveSession({ ...state, manualSortAcked: true })
}

async function handleStopFixing(): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'reviewing' && state.view !== 'fixing') return
  await clearHighlight()
  await saveSession({
    view: 'done',
    channelId: state.channelId,
    channelTitle: state.channelTitle,
    playlistId: state.playlistId,
    fixed: state.fixed,
    skipped: state.skipped,
    errored: state.errored,
    log: state.log,
  })
}

async function handleRescan(): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'done') throw new Error('Not in done state')
  await saveSession({
    view: 'ready',
    channelId: state.channelId,
    channelTitle: state.channelTitle,
    playlistId: state.playlistId,
    manualSortAcked: true,
  })
}

async function handleExportLog(): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'done') return

  const json = JSON.stringify({ log: state.log, exportDate: new Date().toISOString() }, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const date = new Date().toISOString().slice(0, 10)

  await chrome.downloads.download({
    url,
    filename: `youtubereplacer-log-${date}.json`,
    saveAs: false,
    conflictAction: 'uniquify',
  })
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

async function handleDownloadBackup(): Promise<void> {
  const state = await loadSession()
  if (!('playlistId' in state)) throw new Error('No playlist loaded')
  const allItems = await listPlaylistItems(state.playlistId)
  await downloadBackup(state.playlistId, allItems)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0]
}

async function scrollToTrack(videoId: string): Promise<void> {
  const tab = await getActiveTab()
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_TO', videoId }).catch(() => {})
  }
}

async function clearHighlight(): Promise<void> {
  const tab = await getActiveTab()
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHT' }).catch(() => {})
  }
}

