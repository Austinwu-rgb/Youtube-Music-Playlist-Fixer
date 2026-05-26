// Handles scrollIntoView and visual highlight ring for a specific playlist row.
// The highlight CSS is injected directly into the page as a <style> tag so it
// survives YT Music's own style updates.

import { SELECTORS, videoIdFromHref } from '../lib/dom-selectors.js'

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

/** Find the row element for a given videoId. */
function findRow(videoId: string): Element | null {
  const rows = document.querySelectorAll(SELECTORS.row)
  for (const row of rows) {
    const anchor = row.querySelector(SELECTORS.rowTitleLink)
    if (anchor) {
      const href = (anchor as HTMLAnchorElement).href
      if (videoIdFromHref(href) === videoId) return row
    }
  }
  return null
}

/** Scroll the playlist row with this videoId into the centre of the viewport and add highlight ring. */
export function highlightAndScroll(videoId: string): boolean {
  ensureStyle()
  clearHighlight()
  const row = findRow(videoId)
  if (!row) return false
  row.classList.add(HIGHLIGHT_CLASS)
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return true
}

/** Remove highlight ring from all rows. */
export function clearHighlight(): void {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS)
  })
}
