// Centralised YouTube Music DOM selectors.
// When YT Music updates its UI, only this file needs editing.
//
// Verify these selectors against a live playlist with at least one broken
// track by opening DevTools on music.youtube.com and running:
//   document.querySelectorAll(SELECTORS.row)
// Confirmed against YT Music Polymer UI as of May 2026.

export const SELECTORS = {
  // The main scrollable container for playlist content
  scrollContainer: 'ytmusic-app-layout #main-panel',

  // Fallback scroll container if main-panel is absent
  scrollContainerFallback: 'ytmusic-browse-response ytmusic-playlist-shelf-renderer',

  // Each row / track item in the playlist
  row: 'ytmusic-responsive-list-item-renderer',

  // Title link inside a row
  rowTitleLink: 'a.yt-simple-endpoint[href*="watch?v="]',

  // Title text when there is no link (unplayable tracks often lose the anchor)
  rowTitleText: '.title-column .title',

  // Channel / artist text inside a row
  rowChannelText: '.secondary-flex-columns yt-formatted-string',

  // Play button — absent or disabled on unplayable rows
  playButton: '.play-button-shape button, ytmusic-play-button-renderer button',

  // Thumbnail image — useful as a stable anchor for scrollIntoView
  thumbnail: '.thumbnail-overlay-toggle-button-renderer, .yt-img-shadow',

  // Unavailable text hint patterns shown by YT Music on greyed-out rows
  unavailableTextHints: ['Unavailable', 'Not available', 'Video unavailable'],
} as const

/** Extract the videoId from a watch href like "/watch?v=abc123&..." */
export function videoIdFromHref(href: string): string | null {
  try {
    const url = new URL(href, 'https://music.youtube.com')
    return url.searchParams.get('v')
  } catch {
    return null
  }
}
