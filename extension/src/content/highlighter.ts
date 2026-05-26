// Handles scrollIntoView and visual highlight ring for a specific playlist row.

import { findRowByVideoId, findRowByTitle } from './row-finder.js'

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

export function highlightAndScroll(videoId: string, title?: string): boolean {
  ensureStyle()
  clearHighlight()
  const row = findRowByVideoId(videoId) ?? (title ? findRowByTitle(title, true) : null)
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
