// Authenticated fetch wrapper for YouTube Data API v3.
// Handles 401 by removing the stale token and retrying once with a fresh one.

import { getToken, removeCachedToken } from './auth.js'

const BASE = 'https://www.googleapis.com/youtube/v3'

export interface ApiError {
  code: number
  reason?: string
  message: string
}

export class YouTubeApiError extends Error {
  constructor(
    public readonly code: number,
    public readonly reason: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'YouTubeApiError'
  }

  get isQuotaExceeded(): boolean {
    return this.code === 403 && this.reason === 'quotaExceeded'
  }

  get isManualSortRequired(): boolean {
    return (
      this.code === 400 &&
      (this.reason === 'manualSortRequired' ||
        this.message.toLowerCase().includes('manual'))
    )
  }

  get isForbidden(): boolean {
    return this.code === 403
  }
}

async function doFetch(
  endpoint: string,
  params: Record<string, string>,
  token: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<unknown> {
  const url = new URL(`${BASE}/${endpoint}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const resp = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (resp.status === 204) return null

  const json = (await resp.json()) as {
    error?: { code: number; errors?: { reason?: string; message?: string }[] }
  }

  if (!resp.ok) {
    const err = json.error
    const reason = err?.errors?.[0]?.reason
    const message = err?.errors?.[0]?.message ?? `HTTP ${resp.status}`
    throw new YouTubeApiError(resp.status, reason, message)
  }

  return json
}

/** Call a YouTube Data API endpoint, refreshing token once on 401. */
export async function apiFetch(
  endpoint: string,
  params: Record<string, string> = {},
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<unknown> {
  let token = await getToken(false)
  try {
    return await doFetch(endpoint, params, token, method, body)
  } catch (err) {
    if (err instanceof YouTubeApiError && err.code === 401) {
      await removeCachedToken(token)
      token = await getToken(false)
      return await doFetch(endpoint, params, token, method, body)
    }
    throw err
  }
}
