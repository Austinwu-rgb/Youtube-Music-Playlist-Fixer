// Shared helpers for locating playlist rows in the YT Music DOM.

import {
  queryAllRows,
  videoIdFromHref,
  SELECTORS,
  isUnplayableRow,
} from '../lib/dom-selectors.js'
import { normalizeTitle } from '../lib/normalize-title.js'

export function rowTitle(row: Element): string {
  const anchor = row.querySelector(SELECTORS.rowTitleLink) as HTMLAnchorElement | null
  const titleEl =
    anchor ?? (row.querySelector(SELECTORS.rowTitleText) as HTMLElement | null)
  return titleEl?.textContent?.trim() || titleEl?.getAttribute('title')?.trim() || ''
}

export function findRowByVideoId(videoId: string): Element | null {
  for (const row of queryAllRows()) {
    const anchor = row.querySelector(SELECTORS.rowTitleLink) as HTMLAnchorElement | null
    if (anchor && videoIdFromHref(anchor.href) === videoId) return row
  }
  return null
}

export function findRowByTitle(title: string, preferUnplayable = false): Element | null {
  const target = normalizeTitle(title)
  if (!target) return null

  if (preferUnplayable) {
    for (const row of queryAllRows()) {
      if (normalizeTitle(rowTitle(row)) !== target) continue
      if (isUnplayableRow(row)) return row
    }
  }

  for (const row of queryAllRows()) {
    if (normalizeTitle(rowTitle(row)) === target) return row
  }

  return null
}
