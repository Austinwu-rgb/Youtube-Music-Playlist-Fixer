// Content script entry point — injected into every music.youtube.com/* page.
// Responsibilities:
//   1. Report page/playlist info to service worker on navigation
//   2. Run DOM scan on request
//   3. Highlight / scroll to tracks on request

import { runScan, cancelScan } from './scanner.js'
import { highlightAndScroll, clearHighlight } from './highlighter.js'
import {
  markFixedPlaceholder,
  scrollToFixedTrack,
  clearFixedMarkers,
  clearReviewHighlights,
} from './fixed-marker.js'
import type { AppMsg } from '../lib/messages.js'

// ── Page info reporting ───────────────────────────────────────────────────────

function getPlaylistId(): string | null {
  return new URL(location.href).searchParams.get('list')
}

function isOnPlaylistPage(): boolean {
  return location.hostname === 'music.youtube.com' &&
    location.pathname === '/playlist'
}

function reportPageInfo(): void {
  chrome.runtime.sendMessage({
    type: 'PAGE_INFO',
    playlistId: getPlaylistId(),
    onPlaylistPage: isOnPlaylistPage(),
  } satisfies AppMsg).catch(() => {})
}

// Report on initial load and on SPA navigation (YT Music uses history.pushState)
reportPageInfo()

let lastHref = location.href
const navObserver = new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href
    reportPageInfo()
  }
})
navObserver.observe(document.body, { childList: true, subtree: true })

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: AppMsg, _sender, sendResponse) => {
  handleMsg(msg).then(sendResponse).catch((err: Error) => sendResponse({ ok: false, error: err.message }))
  return true
})

async function handleMsg(msg: AppMsg): Promise<{ ok: boolean }> {
  switch (msg.type) {
    case 'DO_SCAN': {
      const rows = await runScan((scanned, foundBroken) => {
        chrome.runtime.sendMessage({
          type: 'SCAN_PROGRESS',
          scanned,
          foundBroken,
        } satisfies AppMsg).catch(() => {})
      })
      chrome.runtime.sendMessage({ type: 'SCAN_DONE', rows } satisfies AppMsg).catch(() => {})
      return { ok: true }
    }

    case 'CANCEL_SCAN_CS':
      cancelScan()
      return { ok: true }

    case 'SCROLL_TO': {
      const found = highlightAndScroll(msg.videoId, msg.title)
      return { ok: true, found }
    }

    case 'CLEAR_HIGHLIGHT':
      clearHighlight()
      return { ok: true }

    case 'MARK_FIXED': {
      const found = markFixedPlaceholder(msg.title, msg.videoId, msg.replacementTitle)
      return { ok: true, found }
    }

    case 'SCROLL_TO_FIXED': {
      const found = await scrollToFixedTrack(msg.videoId, msg.fromTop ?? false)
      return { ok: true, found }
    }

    case 'CLEAR_FIXED_MARKERS':
      clearFixedMarkers()
      clearReviewHighlights()
      return { ok: true }

    default:
      return { ok: true }
  }
}
