// Scroll-until-stable DOM scanner for YouTube Music playlist pages.
// Drives the scan loop from the content script (stable page context) and
// streams progress to the service worker via chrome.runtime.sendMessage.

import { SELECTORS, videoIdFromHref } from '../lib/dom-selectors.js'
import type { ScannedRow } from '../lib/messages.js'

const MAX_HARD_CAP = 20_000
const STABLE_TICKS_REQUIRED = 3
const RENDER_WAIT_MS = 200

interface RowData extends ScannedRow {
  element: Element
}

let scanning = false

export function isScanning(): boolean {
  return scanning
}

export function cancelScan(): void {
  scanning = false
}

/**
 * Run the scroll-until-stable scan.
 * Calls onProgress(scanned, foundBroken) as rows are discovered.
 * Resolves with the full list of ScannedRows when done or cancelled.
 */
export async function runScan(
  onProgress: (scanned: number, foundBroken: number) => void,
): Promise<ScannedRow[]> {
  scanning = true

  const container = findScrollContainer()
  if (!container) {
    scanning = false
    return []
  }

  const seen = new Map<string, RowData>()
  let stableTicks = 0
  let lastCount = 0

  while (scanning && stableTicks < STABLE_TICKS_REQUIRED) {
    // Scroll to bottom
    container.scrollTop = container.scrollHeight

    // Wait for virtual list to render new rows
    await waitForRender(RENDER_WAIT_MS)

    if (!scanning) break

    // Scan currently visible rows
    const rows = document.querySelectorAll(SELECTORS.row)
    for (const el of rows) {
      const data = parseRow(el)
      seen.set(data.key, data)
    }

    const brokenCount = countUnplayable(seen)
    onProgress(seen.size, brokenCount)

    const atBottom =
      Math.abs(container.scrollTop + container.clientHeight - container.scrollHeight) <= 4

    if (seen.size === lastCount && atBottom) {
      stableTicks++
    } else {
      stableTicks = 0
    }
    lastCount = seen.size

    if (seen.size >= MAX_HARD_CAP) break
  }

  scanning = false
  return Array.from(seen.values()).map(({ element: _el, ...row }) => row)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findScrollContainer(): Element | null {
  const primary = document.querySelector(SELECTORS.scrollContainer)
  if (primary) return primary
  const fallback = document.querySelector(SELECTORS.scrollContainerFallback)
  if (fallback) return fallback
  // Last resort: the document element itself scrolls
  return document.documentElement
}

function waitForRender(ms: number): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, ms)),
  )
}

function parseRow(el: Element): RowData {
  // --- Extract videoId ---
  const anchor = el.querySelector(SELECTORS.rowTitleLink) as HTMLAnchorElement | null
  const videoId = anchor ? videoIdFromHref(anchor.href) : null

  // --- Extract title ---
  const titleEl =
    anchor ??
    (el.querySelector(SELECTORS.rowTitleText) as HTMLElement | null)
  const title = titleEl?.textContent?.trim() ?? ''

  // --- Extract channel ---
  const channelEl = el.querySelector(SELECTORS.rowChannelText) as HTMLElement | null
  const channelTitle = channelEl?.textContent?.trim() ?? ''

  // --- Determine unplayable ---
  const isUnplayable = detectUnplayable(el)

  // Stable key: prefer videoId; fall back to title hash
  const key = videoId ?? `title:${title}`

  return { key, videoId, title, channelTitle, isUnplayable, element: el }
}

function detectUnplayable(el: Element): boolean {
  // Signal 1: play button is aria-disabled or absent
  const playBtn = el.querySelector(SELECTORS.playButton)
  if (playBtn?.getAttribute('aria-disabled') === 'true') return true
  if (playBtn?.hasAttribute('disabled')) return true

  // Signal 2: no play button at all when other sibling rows have one
  // (we check this loosely — if the element has no anchor for the track title,
  //  it's likely unavailable)
  if (!el.querySelector(SELECTORS.rowTitleLink)) {
    // Extra guard: also check for unavailable text
    const text = el.textContent ?? ''
    for (const hint of SELECTORS.unavailableTextHints) {
      if (text.includes(hint)) return true
    }
  }

  // Signal 3: explicit unavailable text in the row
  const text = el.textContent ?? ''
  for (const hint of SELECTORS.unavailableTextHints) {
    if (new RegExp(`\\b${hint}\\b`, 'i').test(text)) return true
  }

  // Signal 4: opacity / greyed-out style class
  // YT Music adds an 'unplayable' or 'disabled' CSS class on the renderer
  const classes = el.className + ' ' + (el.getAttribute('disabled') ?? '')
  if (/\bunplayable\b|\bdisabled\b/i.test(classes)) return true

  return false
}

function countUnplayable(seen: Map<string, RowData>): number {
  let n = 0
  for (const r of seen.values()) if (r.isUnplayable) n++
  return n
}
