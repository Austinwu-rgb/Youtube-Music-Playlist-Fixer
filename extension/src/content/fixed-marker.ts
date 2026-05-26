// Placeholder overlays for fixed tracks (before reload) and post-reload review scroll.

import { SELECTORS, queryAllRows } from '../lib/dom-selectors.js'
import { findRowByTitle, findRowByVideoId } from './row-finder.js'
import type { FixedTrackRef } from '../lib/messages.js'

const STYLE_ID = 'ytmr-fixed-marker-style'
const OVERLAY_CLASS = 'ytmr-fixed-overlay'
const REVIEW_CLASS = 'ytmr-fixed-review'

const PLACEHOLDER_MSG =
  'This track has been fixed. Finish reviewing the remaining tracks — the playlist will refresh when you\'re done so you can confirm.'

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    ytmusic-responsive-list-item-renderer.${OVERLAY_CLASS},
    ytmusic-two-row-item-renderer.${OVERLAY_CLASS} {
      position: relative !important;
    }
    .${OVERLAY_CLASS}__banner {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      background: rgba(18, 18, 22, 0.94);
      border: 2px solid #00c853;
      border-radius: 6px;
      box-sizing: border-box;
      pointer-events: none;
      font-family: "Roboto", "Arial", sans-serif;
    }
    .${OVERLAY_CLASS}__badge {
      flex-shrink: 0;
      padding: 4px 8px;
      border-radius: 4px;
      background: #00c853;
      color: #000;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .${OVERLAY_CLASS}__text {
      margin: 0;
      color: #e8eaed;
      font-size: 13px;
      line-height: 1.35;
    }
    .${REVIEW_CLASS} {
      outline: 3px solid #00c853 !important;
      outline-offset: 2px !important;
      border-radius: 4px !important;
    }
  `
  document.head.appendChild(style)
}

/** Cover a still-unplayable row with a "fixed — pending reload" banner. */
export function markFixedPlaceholder(
  title: string,
  videoId: string,
  replacementTitle?: string,
): boolean {
  ensureStyles()
  const row =
    findRowByTitle(title, true) ??
    findRowByTitle(title) ??
    findRowByVideoId(videoId)
  if (!row) return false

  row.querySelector(`.${OVERLAY_CLASS}__banner`)?.remove()
  row.classList.add(OVERLAY_CLASS)

  const banner = document.createElement('div')
  banner.className = `${OVERLAY_CLASS}__banner`
  banner.innerHTML = `
    <span class="${OVERLAY_CLASS}__badge">Fixed</span>
    <p class="${OVERLAY_CLASS}__text">${PLACEHOLDER_MSG}${
      replacementTitle
        ? `<br><span style="opacity:0.75;font-size:12px">Replacement: ${escapeHtml(replacementTitle)}</span>`
        : ''
    }</p>
  `
  row.appendChild(banner)
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return true
}

export function clearFixedMarkers(): void {
  document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((row) => {
    row.classList.remove(OVERLAY_CLASS)
    row.querySelector(`.${OVERLAY_CLASS}__banner`)?.remove()
  })
  document.querySelectorAll(`.${REVIEW_CLASS}`).forEach((row) => {
    row.classList.remove(REVIEW_CLASS)
  })
}

export function clearReviewHighlights(): void {
  document.querySelectorAll(`.${REVIEW_CLASS}`).forEach((row) => {
    row.classList.remove(REVIEW_CLASS)
  })
}

/** Scroll to a single fixed track and highlight it for user verification. */
export async function scrollToFixedTrack(
  videoId: string,
  fromTop = false,
): Promise<boolean> {
  ensureStyles()
  clearReviewHighlights()

  const container = findScrollContainer()
  if (fromTop) {
    scrollToTop(container)
    await wait(400)
  }

  const row = await scrollUntilVideoFound(container, videoId)
  if (!row) return false

  row.classList.add(REVIEW_CLASS)
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return true
}

// ── Scroll helpers (subset of scanner — find rows in virtualized playlists) ───

function findScrollContainer(): Element {
  for (const sel of SELECTORS.scrollContainerCandidates) {
    const el = document.querySelector(sel)
    if (el && isScrollable(el)) return el
  }
  const rows = queryAllRows()
  if (rows[0]) {
    const ancestor = findScrollableAncestor(rows[0])
    if (ancestor) return ancestor
  }
  return document.scrollingElement ?? document.documentElement
}

function isScrollable(el: Element): boolean {
  const style = getComputedStyle(el)
  const oy = style.overflowY
  if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false
  return el.scrollHeight > el.clientHeight + 20
}

function findScrollableAncestor(el: Element): Element | null {
  let node: Element | null = el.parentElement
  while (node && node !== document.documentElement) {
    if (isScrollable(node)) return node
    node = node.parentElement
  }
  return null
}

function scrollToTop(container: Element): void {
  if (container === document.documentElement || container === document.body) {
    window.scrollTo({ top: 0, behavior: 'instant' })
  } else {
    container.scrollTop = 0
  }
}

function scrollDown(container: Element): void {
  const rows = queryAllRows()
  const last = rows[rows.length - 1]
  if (last) last.scrollIntoView({ block: 'end', behavior: 'instant' })

  if (container === document.documentElement || container === document.body) {
    window.scrollBy({ top: 700, behavior: 'instant' })
  } else {
    container.scrollTop += 700
    window.scrollBy({ top: 700, behavior: 'instant' })
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, ms)),
  )
}

async function scrollUntilVideoFound(
  container: Element,
  videoId: string,
  maxIterations = 500,
): Promise<Element | null> {
  for (let i = 0; i < maxIterations; i++) {
    const row = findRowByVideoId(videoId)
    if (row) return row
    scrollDown(container)
    await wait(300)
  }
  return null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
