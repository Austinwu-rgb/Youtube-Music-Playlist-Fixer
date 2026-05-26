// Ported from youtube_fix/search.py normalize_title + playlist.py _normalize_title.
// Strips noise so titles can be compared across YouTube and YouTube Music.

export function normalizeTitle(t: string): string {
  t = t.toLowerCase()
  // remove bracketed / parenthetical noise: [Official Video], (feat. X), etc.
  t = t.replace(/\s*\[[^\]]+\]|\s*\([^)]+\)/g, ' ')
  // strip common suffixes
  t = t.replace(/\b(official|audio|video|lyrics|mv|hd|hq|remaster(ed)?)\b/g, ' ')
  // strip punctuation
  t = t.replace(/[^\w\s]/g, ' ')
  // collapse whitespace
  t = t.replace(/\s+/g, ' ').trim()
  return t
}
