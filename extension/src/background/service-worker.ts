// MV3 Service Worker — message router, auth, and API orchestration.
// All YouTube Data API calls live here.
// State is persisted to chrome.storage.session after every mutation so that
// worker restarts don't lose progress.

import { getToken, signOut as authSignOut } from '../lib/auth.js'
import {
  getMyChannel,
  listPlaylistItems,
  fetchPlaylistItemByPiId,
  resolveBrokenTrackApiItem,
  cachePlaylistItems,
  getCachedPlaylistItems,
  verifyPlaylistOwnership,
  YouTubeApiError,
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

  // Fetch playlist items from API to get piId + position (DOM rows often lack videoId)
  const apiItems = await listPlaylistItems(state.playlistId)
  await cachePlaylistItems(state.playlistId, apiItems)

  const broken: BrokenTrack[] = []
  const seenPiIds = new Set<string>()
  for (const row of unplayable) {
    const apiItem = resolveBrokenTrackApiItem(row, apiItems)
    if (!apiItem || seenPiIds.has(apiItem.piId)) continue
    seenPiIds.add(apiItem.piId)

    broken.push({
      videoId: apiItem.videoId,
      title: row.title || apiItem.title,
      channelTitle: row.channelTitle || apiItem.channelTitle,
      position: apiItem.position,
      piId: apiItem.piId,
    })
  }

  const scanIncomplete = rows.length < apiItems.length * 0.5

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
      scannedTotal: rows.length,
      noBrokenFound: true,
      scanIncomplete,
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
  if (first) await scrollToTrack(first.videoId, first.title)
}

async function handleRequestCandidates(title: string, videoId: string): Promise<void> {
  const state = await loadSession()
  if (state.view !== 'reviewing' && state.view !== 'fixing') {
    throw new Error('Not in reviewing state')
  }

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

  // Scroll when entering fixing from reviewing (not on in-place re-search)
  if (state.view === 'reviewing') {
    await scrollToTrack(videoId, title)
  }
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
    // Back up before first edit (reuse scan cache — avoid re-fetching huge playlists)
    if (!state.backupDone) {
      try {
        const cached = await getCachedPlaylistItems(state.playlistId)
        const allItems = cached ?? (await listPlaylistItems(state.playlistId))
        await downloadBackup(state.playlistId, allItems)
      } catch (backupErr) {
        console.warn('Backup failed, continuing with replace:', backupErr)
      }
    }

    // Re-fetch by piId (reliable even when the same videoId appears more than once)
    const fresh = await fetchPlaylistItemByPiId(current.piId)
    if (!fresh) {
      throw new Error(
        `Could not find "${current.title}" in the playlist anymore. It may have been removed — try skipping.`,
      )
    }

    // Insert replacement at same position, then delete original
    newPiId = await insertAt(state.playlistId, newVideoId, fresh.position)
    await deleteItem(fresh.piId)

    const candidateInfo = state.candidates.find((c) => c.videoId === newVideoId)
    logEntry.replacementVideoId = newVideoId
    logEntry.replacementTitle = candidateInfo?.title ?? newVideoId
  } catch (err) {
    const error = friendlyApiError(err)
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
            scannedTotal: 0,
            noBrokenFound: false,
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
    if (next) await scrollToTrack(next.videoId, next.title)
  } else {
    await saveSession({
      view: 'done',
      ...baseNext,
      scannedTotal: 0,
      noBrokenFound: false,
    })
    await clearHighlight()
    await reloadPlaylistTab()
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
    if (next) await scrollToTrack(next.videoId, next.title)
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
      scannedTotal: 0,
      noBrokenFound: false,
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
  const hadFixes = state.fixed > 0
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
    scannedTotal: 0,
    noBrokenFound: false,
  })
  if (hadFixes) await reloadPlaylistTab()
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

function friendlyApiError(err: unknown): Error {
  if (err instanceof YouTubeApiError) {
    if (err.isManualSortRequired) {
      return new Error(
        'This playlist must use Manual sort order. In YouTube Music, open the playlist → sort menu → choose Manual, then try again.',
      )
    }
    if (err.isQuotaExceeded) {
      return new Error('YouTube API daily quota exceeded. Try again tomorrow.')
    }
    if (err.isForbidden) {
      return new Error(
        `YouTube API permission denied: ${err.message}. Make sure you own this playlist and are signed into the correct account.`,
      )
    }
    return new Error(err.message)
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0]
}

async function reloadPlaylistTab(): Promise<void> {
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url?.includes('music.youtube.com')) return

  await chrome.tabs.reload(tab.id)

  await new Promise<void>((resolve) => {
    const tabId = tab.id!
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      resolve()
    }, 20_000)

    function onUpdated(updatedId: number, info: chrome.tabs.TabChangeInfo): void {
      if (updatedId === tabId && info.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
  })

  // YT Music needs a moment to render the playlist shelf after load
  await new Promise((r) => setTimeout(r, 2000))
}

async function scrollToTrack(videoId: string, title?: string): Promise<void> {
  const tab = await getActiveTab()
  if (!tab?.id) return

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500))
    try {
      const resp = (await chrome.tabs.sendMessage(tab.id, {
        type: 'SCROLL_TO',
        videoId,
        title,
      })) as { ok?: boolean; found?: boolean }
      if (resp?.found) return
    } catch {
      // Content script may not be ready yet after reload
    }
  }
}

async function clearHighlight(): Promise<void> {
  const tab = await getActiveTab()
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHT' }).catch(() => {})
  }
}

