// Centralised YouTube Music DOM selectors.
// When YT Music updates its UI, only this file needs editing.

export const SELECTORS = {
  // Scroll container candidates (tried in order by findScrollContainer)
  scrollContainerCandidates: [
    'ytmusic-playlist-shelf-renderer #contents',
    'ytmusic-shelf-renderer #contents',
    'ytmusic-browse-response #contents',
    'ytmusic-tabbed-search-results-renderer #contents',
    'ytmusic-app-layout #content',
    'ytmusic-app-layout #main-panel',
    '#page-manager',
  ],

  // Row renderers used on playlist pages (try all)
  rowSelectors: [
    'ytmusic-responsive-list-item-renderer',
    'ytmusic-two-row-item-renderer',
  ],

  rowTitleLink: 'a[href*="watch?v="], a[href*="v="]',

  rowTitleText: 'yt-formatted-string.title, .title-column .title, .title-column yt-formatted-string',

  rowChannelText: '.secondary-flex-columns yt-formatted-string, .byline',

  playButton: '.play-button-shape button, ytmusic-play-button-renderer button, button[aria-label*="Play"]',

  unavailableTextHints: ['Unavailable', 'Not available', 'Video unavailable', "Can't play"],

  // Playlist header track count, e.g. "3,324 tracks"
  trackCountPattern: /([\d,]+)\s+tracks?\b/i,
} as const

/** Detect unplayable/greyed-out rows from YT Music DOM signals. */
export function isUnplayableRow(el: Element): boolean {
  // Only trust YT Music's explicit markers — secondary heuristics (placeholder
  // thumbnails, missing watch links) fire on playable rows while virtual-scrolling.
  if (el.hasAttribute('unplayable')) return true

  const displayPolicy = el.getAttribute('display-policy') ?? ''
  if (displayPolicy.includes('GREY_OUT')) return true

  return false
}

/** Extract the videoId from a watch href like "/watch?v=abc123&..." */
export function videoIdFromHref(href: string): string | null {
  try {
    const url = new URL(href, 'https://music.youtube.com')
    return url.searchParams.get('v')
  } catch {
    return null
  }
}

/** Query rows in light DOM and open shadow roots (YT Music uses both). */
export function queryAllRows(): Element[] {
  const seen = new Set<Element>()
  const selectors = SELECTORS.rowSelectors.join(',')

  function collect(root: Document | ShadowRoot | Element): void {
    root.querySelectorAll(selectors).forEach((el) => seen.add(el))
  }

  collect(document)

  function walk(root: Document | ShadowRoot): void {
    collect(root)
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot)
    })
  }

  walk(document)

  // Also pick up explicitly marked unplayable rows (may use different renderer nesting)
  document
    .querySelectorAll(
      'ytmusic-responsive-list-item-renderer[unplayable], ytmusic-two-row-item-renderer[unplayable]',
    )
    .forEach((el) => seen.add(el))

  return Array.from(seen)
}

/** Parse expected track count from playlist page header. */
export function getExpectedTrackCount(): number | null {
  const m = document.body.innerText.match(SELECTORS.trackCountPattern)
  if (!m?.[1]) return null
  return parseInt(m[1].replace(/,/g, ''), 10)
}
