// Handles scrollIntoView and visual highlight ring for a specific playlist row.

import {
  queryAllRows,
  videoIdFromHref,
  SELECTORS,
  isUnplayableRow,
} from '../lib/dom-selectors.js'
import { normalizeTitle } from '../lib/normalize-title.js'

const HIGHLIGHT_CLASS = 'ytmr-highlight'
const STYLE_ID = 'ytmr-highlight-style'

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 3px solid #ff0057 !important;
      outline-offset: 2px !important;
      border-radius: 4px !important;
      transition: outline 0.2s ease !important;
    }
  `
  document.head.appendChild(style)
}

function rowTitle(row: Element): string {
  const anchor = row.querySelector(SELECTORS.rowTitleLink) as HTMLAnchorElement | null
  const titleEl =
    anchor ?? (row.querySelector(SELECTORS.rowTitleText) as HTMLElement | null)
  return titleEl?.textContent?.trim() || titleEl?.getAttribute('title')?.trim() || ''
}

function findRowByVideoId(videoId: string): Element | null {
  for (const row of queryAllRows()) {
    const anchor = row.querySelector(SELECTORS.rowTitleLink) as HTMLAnchorElement | null
    if (anchor && videoIdFromHref(anchor.href) === videoId) return row
  }
  return null
}

function findRowByTitle(title: string): Element | null {
  const target = normalizeTitle(title)
  if (!target) return null

  for (const row of queryAllRows()) {
    if (normalizeTitle(rowTitle(row)) !== target) continue
    if (isUnplayableRow(row)) return row
  }

  // Fall back to any title match if the row is no longer marked unplayable
  for (const row of queryAllRows()) {
    if (normalizeTitle(rowTitle(row)) === target) return row
  }

  return null
}

export function highlightAndScroll(videoId: string, title?: string): boolean {
  ensureStyle()
  clearHighlight()
  const row = findRowByVideoId(videoId) ?? (title ? findRowByTitle(title) : null)
  if (!row) return false
  row.classList.add(HIGHLIGHT_CLASS)
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return true
}

export function clearHighlight(): void {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS)
  })
}
