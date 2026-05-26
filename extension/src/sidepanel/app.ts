// Side panel vanilla TypeScript app.
// Re-renders the main area on every state update from the service worker.

import type { AppMsg, CandidateVideo } from '../lib/messages.js'
import type { AppState, SessionLogEntry } from '../background/session.js'
import { formatDuration } from '../lib/search.js'
import { getQuotaStatus } from '../lib/quota.js'

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const main = document.getElementById('main')!
const accountBar = document.getElementById('account-bar')!
const channelNameEl = document.getElementById('channel-name')!
const quotaBarEl = document.getElementById('quota-bar')!
const quotaFillEl = document.getElementById('quota-fill')!
const quotaLabelEl = document.getElementById('quota-label')!

document.getElementById('btn-sign-out')!.addEventListener('click', () => {
  send({ type: 'SIGN_OUT' })
})

// Listen for state updates pushed from service worker
chrome.runtime.onMessage.addListener((msg: AppMsg) => {
  if (msg.type === 'STATE_UPDATE') refresh()
})

// Initial load
refresh()

// Periodically refresh quota bar
setInterval(refreshQuota, 10_000)

// ── Core ──────────────────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  const state = await send<AppState>({ type: 'GET_STATE' })
  render(state)
  refreshQuota()
}

async function refreshQuota(): Promise<void> {
  try {
    const q = await getQuotaStatus()
    const pct = Math.min(100, Math.round((q.used / q.limit) * 100))
    quotaBarEl.classList.remove('hidden')
    quotaFillEl.style.width = `${pct}%`
    quotaFillEl.className = 'quota-fill' + (q.overLimit ? ' over' : q.nearLimit ? ' warn' : '')
    quotaLabelEl.textContent = `${q.used.toLocaleString()} / ${q.limit.toLocaleString()} units`
  } catch {
    quotaBarEl.classList.add('hidden')
  }
}

function render(state: AppState): void {
  // Header account bar
  if (state.view === 'signed-out') {
    accountBar.classList.add('hidden')
  } else {
    accountBar.classList.remove('hidden')
    channelNameEl.textContent = 'channelTitle' in state ? state.channelTitle : ''
  }

  // Main view
  switch (state.view) {
    case 'signed-out':      return renderSignedOut()
    case 'needs-playlist':  return renderNeedsPlaylist()
    case 'ready':           return renderReady(state)
    case 'scanning':        return renderScanning(state)
    case 'reviewing':       return renderReviewing(state)
    case 'fixing':          return renderFixing(state)
    case 'done':            return renderDone(state)
  }
}

// ── Views ─────────────────────────────────────────────────────────────────────

function renderSignedOut(): void {
  main.innerHTML = `
    <div class="status-msg">
      <span class="emoji">🎵</span>
      <h2>YouTube Music Replacer</h2>
      <p>Find and replace unplayable tracks in your playlists using the official YouTube Data API.</p>
    </div>
    <button id="btn-sign-in" class="btn btn-primary btn-full" style="margin-top:8px">
      Sign in with Google
    </button>
    <p class="text-sm" style="text-align:center;margin-top:10px">
      Uses your YouTube account. No data leaves your browser except YouTube API calls.
    </p>
  `
  document.getElementById('btn-sign-in')!.addEventListener('click', async () => {
    setLoading(true)
    try {
      await send({ type: 'SIGN_IN' })
      await refresh()
    } catch (err) {
      await refresh()
      showError((err as Error).message)
    }
  })
}

function renderNeedsPlaylist(): void {
  main.innerHTML = `
    <div class="status-msg">
      <span class="emoji">🎧</span>
      <h2>Open a playlist</h2>
      <p>Navigate to one of your playlists on <strong>music.youtube.com</strong> to get started.</p>
    </div>
    <div class="alert alert-warn" style="margin-top:16px">
      <strong>Before scanning:</strong> make sure your playlist sort order is set to
      <strong>Manual</strong> in YouTube Music settings — otherwise replacements
      cannot be placed at the correct position.
      <br><br>
      <a href="https://music.youtube.com" target="_blank" class="link-btn">Open YouTube Music →</a>
    </div>
  `
}

function renderReady(state: Extract<AppState, { view: 'ready' }>): void {
  main.innerHTML = `
    <div class="card">
      <div class="card-title">Playlist ready</div>
      <p class="text-sm" style="margin-bottom:10px">
        ID: <code>${state.playlistId}</code>
      </p>
    </div>

    <label class="check-row" id="manual-sort-check">
      <input type="checkbox" id="ack-manual-sort" ${state.manualSortAcked ? 'checked' : ''} />
      <span>
        I have set this playlist sort to <strong>Manual (Custom)</strong> in YouTube Music.
        <a href="https://support.google.com/youtubemusic/answer/9313258" target="_blank">How?</a>
      </span>
    </label>

    <button id="btn-backup" class="btn btn-secondary btn-full" style="margin-bottom:8px">
      ↓ Download backup first (recommended)
    </button>

    <button id="btn-scan" class="btn btn-primary btn-full" ${state.manualSortAcked ? '' : 'disabled'}>
      Scan playlist for broken tracks
    </button>
  `

  const ackBox = document.getElementById('ack-manual-sort') as HTMLInputElement
  const scanBtn = document.getElementById('btn-scan') as HTMLButtonElement

  ackBox.addEventListener('change', () => {
    if (ackBox.checked) scanBtn.removeAttribute('disabled')
    else scanBtn.setAttribute('disabled', '')
  })

  scanBtn.addEventListener('click', async () => {
    if (!ackBox.checked) return
    // Patch ack into session manually before scan
    await patchReadyAck()
    await send({ type: 'START_SCAN' })
    await refresh()
  })

  document.getElementById('btn-backup')!.addEventListener('click', async () => {
    setLoading(true)
    await send({ type: 'DOWNLOAD_BACKUP' })
    setLoading(false)
  })
}

async function patchReadyAck(): Promise<void> {
  await send({ type: 'ACK_MANUAL_SORT' })
}

function renderScanning(state: Extract<AppState, { view: 'scanning' }>): void {
  main.innerHTML = `
    <div class="card">
      <div class="card-title">Scanning playlist…</div>
      <p class="progress-label">Scanned <strong>${state.scanned}</strong> tracks — <strong>${state.foundBroken}</strong> unplayable found</p>
      <div class="progress-wrap">
        <div class="progress-fill" style="width:${state.scanned > 0 ? Math.min(95, state.scanned / 50) : 5}%"></div>
      </div>
      <p class="text-sm" style="margin-top:6px">Scrolling through the playlist — large playlists may take several minutes. Keep this tab visible. The unplayable count is refined once the scan finishes.</p>
    </div>
    <button id="btn-cancel-scan" class="btn btn-secondary btn-full">Cancel scan</button>
  `
  document.getElementById('btn-cancel-scan')!.addEventListener('click', () => {
    send({ type: 'CANCEL_SCAN' }).then(() => refresh())
  })
}

function renderReviewing(state: Extract<AppState, { view: 'reviewing' }>): void {
  const current = state.broken[state.currentIndex]
  const remaining = state.broken.length - state.currentIndex
  if (!current) {
    send({ type: 'STOP_FIXING' }).then(() => refresh())
    return
  }

  main.innerHTML = `
    <div class="stats-row">
      <div class="stat-chip fixed"><div class="stat-value">${state.fixed}</div><div class="stat-label">Fixed</div></div>
      <div class="stat-chip skipped"><div class="stat-value">${state.skipped}</div><div class="stat-label">Skipped</div></div>
      <div class="stat-chip errored"><div class="stat-value">${state.errored}</div><div class="stat-label">Errors</div></div>
    </div>

    <div class="card">
      <div class="card-title">Broken track ${state.currentIndex + 1} of ${state.broken.length}</div>
      <div class="track-pos">Position ${current.position + 1}</div>
      <div class="track-info">
        <div class="track-title">${esc(current.title)}</div>
        <div class="track-meta">${esc(current.channelTitle)}</div>
      </div>
      <div class="action-row">
        <button id="btn-replace" class="btn btn-primary">Replace</button>
        <button id="btn-skip" class="btn btn-secondary">Skip</button>
      </div>
      <div style="margin-top:8px">
        <button id="btn-stop" class="btn btn-ghost btn-full btn-sm">Stop fixing</button>
      </div>
    </div>

    <p class="text-sm" style="text-align:center">${remaining - 1} more broken track${remaining - 1 !== 1 ? 's' : ''} after this one</p>
  `

  document.getElementById('btn-replace')!.addEventListener('click', async () => {
    setLoading(true)
    try {
      await send({ type: 'REQUEST_CANDIDATES', title: current.title, videoId: current.videoId })
      await refresh()
    } catch (err) {
      await refresh()
      showError((err as Error).message)
    }
  })

  document.getElementById('btn-skip')!.addEventListener('click', async () => {
    await send({ type: 'SKIP_TRACK' })
    await refresh()
  })

  document.getElementById('btn-stop')!.addEventListener('click', async () => {
    await send({ type: 'STOP_FIXING' })
    await refresh()
  })
}

function renderFixing(state: Extract<AppState, { view: 'fixing' }>): void {
  const current = state.broken[state.currentIndex]
  if (!current) return

  let selected: string | null = null

  main.innerHTML = `
    <div class="card">
      <div class="card-title">Choose replacement</div>
      <div class="track-pos">Replacing: ${esc(current.title)}</div>

      <div class="search-row" style="margin-top:8px">
        <input id="search-input" class="search-input" type="text" value="${esc(state.searchQuery)}" placeholder="Search query…" />
        <button id="btn-search-again" class="btn btn-secondary btn-sm">Search</button>
      </div>

      <div class="candidate-list" id="candidate-list">
        ${renderCandidates(state.candidates)}
      </div>

      <div class="action-row">
        <button id="btn-confirm" class="btn btn-primary" disabled>Confirm replace</button>
        <button id="btn-back" class="btn btn-secondary">Back</button>
      </div>
    </div>
  `

  const list = document.getElementById('candidate-list')!
  const confirmBtn = document.getElementById('btn-confirm') as HTMLButtonElement

  list.addEventListener('click', (e) => {
    const item = (e.target as Element).closest('.candidate-item') as HTMLElement | null
    if (!item) return
    list.querySelectorAll('.candidate-item').forEach((el) => el.classList.remove('selected'))
    item.classList.add('selected')
    selected = item.dataset['videoId'] ?? null
    confirmBtn.disabled = !selected
  })

  confirmBtn.addEventListener('click', async () => {
    if (!selected) return
    setLoading(true)
    try {
      await send({ type: 'CONFIRM_REPLACE', piId: current.piId, newVideoId: selected, title: current.title })
      await refresh()
    } catch (err) {
      await refresh()
      showError((err as Error).message)
    }
  })

  document.getElementById('btn-back')!.addEventListener('click', async () => {
    await send({ type: 'BACK_FROM_FIXING' })
    await refresh()
  })

  document.getElementById('btn-search-again')!.addEventListener('click', async () => {
    const q = (document.getElementById('search-input') as HTMLInputElement).value.trim()
    if (!q) return
    setLoading(true)
    try {
      await send({ type: 'REQUEST_CANDIDATES', title: q, videoId: current.videoId })
      await refresh()
    } catch (err) {
      await refresh()
      showError((err as Error).message)
    }
  })
}

function renderDone(state: Extract<AppState, { view: 'done' }>): void {
  if (state.noBrokenFound) {
    const incompleteMsg = state.scanIncomplete
      ? `<div class="alert alert-warn" style="margin-bottom:12px">
           Scan may be incomplete — only <strong>${state.scannedTotal}</strong> tracks were detected in the page.
           Try scrolling the playlist manually once, then scan again. Keep this tab in focus during the scan.
         </div>`
      : `<p class="text-sm" style="text-align:center;margin-bottom:12px">
           Scanned <strong>${state.scannedTotal}</strong> tracks. None were unplayable on YouTube Music.
         </p>`

    main.innerHTML = `
      <div class="status-msg" style="margin-bottom:12px">
        <span class="emoji">${state.scanIncomplete ? '⚠️' : '✅'}</span>
        <h2>${state.scanIncomplete ? 'Scan incomplete' : 'No broken tracks found'}</h2>
      </div>
      ${incompleteMsg}
      <div class="action-row">
        <button id="btn-rescan" class="btn btn-primary">Scan again</button>
      </div>
    `
  } else {
    main.innerHTML = `
      <div class="status-msg" style="margin-bottom:12px">
        <span class="emoji">✅</span>
        <h2>All done!</h2>
      </div>

      <div class="stats-row">
        <div class="stat-chip fixed"><div class="stat-value">${state.fixed}</div><div class="stat-label">Fixed</div></div>
        <div class="stat-chip skipped"><div class="stat-value">${state.skipped}</div><div class="stat-label">Skipped</div></div>
        <div class="stat-chip errored"><div class="stat-value">${state.errored}</div><div class="stat-label">Errors</div></div>
      </div>

      <div class="action-row" style="margin-top:4px">
        <button id="btn-rescan" class="btn btn-primary">Scan again</button>
        <button id="btn-export" class="btn btn-secondary">Export log</button>
      </div>
    `
  }

  document.getElementById('btn-rescan')!.addEventListener('click', async () => {
    await send({ type: 'RESCAN' })
    await refresh()
  })

  document.getElementById('btn-export')?.addEventListener('click', async () => {
    await send({ type: 'EXPORT_LOG' })
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderCandidates(candidates: CandidateVideo[]): string {
  if (candidates.length === 0) {
    return '<p class="text-sm" style="text-align:center;padding:12px">No candidates found. Try editing the search query.</p>'
  }
  return candidates
    .map(
      (c) => `
    <div class="candidate-item" data-video-id="${esc(c.videoId)}">
      <img class="candidate-thumb" src="${esc(c.thumbnailUrl)}" alt="" loading="lazy" />
      <div class="candidate-info">
        <div class="candidate-title">${esc(c.title)}</div>
        <div class="candidate-channel">${esc(c.channelTitle)}</div>
      </div>
      <div class="candidate-duration">${formatDuration(c.durationSec)}</div>
    </div>`,
    )
    .join('')
}

function setLoading(on: boolean): void {
  if (on) {
    main.innerHTML = `<div style="display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>`
  }
}

function showError(msg: string): void {
  const el = document.createElement('div')
  el.className = 'alert alert-error'
  el.style.marginTop = '8px'
  el.textContent = msg
  main.prepend(el)
  setTimeout(() => el.remove(), 6000)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function send<T = unknown>(msg: AppMsg): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp: { ok: boolean; data?: T; error?: string }) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!resp || !resp.ok) {
        reject(new Error(resp?.error ?? 'Unknown error'))
        return
      }
      resolve(resp.data as T)
    })
  })
}
