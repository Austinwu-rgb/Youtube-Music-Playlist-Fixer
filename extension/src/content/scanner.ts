// Scroll-until-stable DOM scanner for YouTube Music playlist pages.

import {
  SELECTORS,
  videoIdFromHref,
  queryAllRows,
  getExpectedTrackCount,
  isUnplayableRow,
} from '../lib/dom-selectors.js'
import type { ScannedRow } from '../lib/messages.js'

const MAX_HARD_CAP = 20_000
const STABLE_TICKS_REQUIRED = 5
const RENDER_WAIT_MS = 350
const SCROLL_STEP_PX = 700
const MAX_SCROLL_ITERATIONS = 500

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

export async function runScan(
  onProgress: (scanned: number, foundBroken: number) => void,
): Promise<ScannedRow[]> {
  scanning = true

  const container = findScrollContainer()
  const expectedTotal = getExpectedTrackCount()
  const seen = new Map<string, RowData>()
  let stableTicks = 0
  let lastCount = 0
  let iterations = 0
  let lastScrollTop = getScrollTop(container)

  // Start from top of playlist
  scrollToTop(container)
  await waitForRender(RENDER_WAIT_MS)

  while (scanning && iterations < MAX_SCROLL_ITERATIONS) {
    iterations++

    // Collect all currently rendered rows
    for (const el of queryAllRows()) {
      const data = parseRow(el)
      if (data.key && data.key !== 'title:') {
        const prev = seen.get(data.key)
        if (prev?.isUnplayable) data.isUnplayable = true
        seen.set(data.key, data)
      }
    }

    const brokenCount = countUnplayable(seen)
    onProgress(seen.size, brokenCount)

    // Done if we reached the playlist's advertised track count
    if (expectedTotal !== null && seen.size >= expectedTotal) {
      break
    }

    // Scroll down one step + bring last row into view (drives virtualized lists)
    scrollDown(container)
    await waitForRender(RENDER_WAIT_MS)

    if (!scanning) break

    const newScrollTop = getScrollTop(container)
    const scrollMoved = Math.abs(newScrollTop - lastScrollTop) > 2
    lastScrollTop = newScrollTop

    const countGrew = seen.size > lastCount
    if (!countGrew && !scrollMoved) {
      stableTicks++
    } else {
      stableTicks = 0
    }
    lastCount = seen.size

    if (stableTicks >= STABLE_TICKS_REQUIRED) {
      break
    }

    if (seen.size >= MAX_HARD_CAP) break
  }

  scanning = false
  return Array.from(seen.values()).map(({ element: _el, ...row }) => row)
}

// ── Scroll helpers ────────────────────────────────────────────────────────────

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

function getScrollTop(container: Element): number {
  if (container === document.documentElement || container === document.body) {
    return window.scrollY
  }
  return container.scrollTop
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

  // Primary: scroll the last visible row into view (best for virtualized lists)
  if (last) {
    last.scrollIntoView({ block: 'end', behavior: 'instant' })
  }

  // Secondary: nudge scroll container / window
  if (container === document.documentElement || container === document.body) {
    window.scrollBy({ top: SCROLL_STEP_PX, behavior: 'instant' })
  } else {
    container.scrollTop += SCROLL_STEP_PX
    // Also try scrolling the window — YT Music often uses page-level scroll
    window.scrollBy({ top: SCROLL_STEP_PX, behavior: 'instant' })
  }
}

function waitForRender(ms: number): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, ms)),
  )
}

// ── Row parsing ───────────────────────────────────────────────────────────────

function elementText(el: Element | null | undefined): string {
  if (!el) return ''
  return el.textContent?.trim() || el.getAttribute('title')?.trim() || ''
}

function parseRow(el: Element): RowData {
  const anchor = el.querySelector(SELECTORS.rowTitleLink) as HTMLAnchorElement | null
  const videoId = anchor ? videoIdFromHref(anchor.href) : null

  const titleEl =
    anchor ?? (el.querySelector(SELECTORS.rowTitleText) as HTMLElement | null)
  const title = elementText(titleEl)

  const channelEl = el.querySelector(SELECTORS.rowChannelText) as HTMLElement | null
  const channelTitle = elementText(channelEl)

  const isUnplayable = isUnplayableRow(el)
  const key = videoId ?? `title:${title}`

  return { key, videoId, title, channelTitle, isUnplayable, element: el }
}

function countUnplayable(seen: Map<string, RowData>): number {
  const counted = new Set<string>()
  let n = 0
  for (const r of seen.values()) {
    if (!r.isUnplayable) continue
    const dedupeKey = (r.videoId ?? r.title.trim().toLowerCase()) || r.key
    if (counted.has(dedupeKey)) continue
    counted.add(dedupeKey)
    n++
  }
  return n
}
