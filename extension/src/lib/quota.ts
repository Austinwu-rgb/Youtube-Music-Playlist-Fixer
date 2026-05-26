// Daily YouTube Data API quota tracker.
// Stores units-used in chrome.storage.local, keyed by UTC date.
// Default daily cap: 10,000 units. Warn at 80%.

const STORAGE_KEY = 'ytmr_quota'
const DAILY_LIMIT = 10_000
const WARN_THRESHOLD = 0.8

interface QuotaStore {
  date: string       // 'YYYY-MM-DD' UTC
  used: number
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

async function load(): Promise<QuotaStore> {
  const result = await chrome.storage.local.get(STORAGE_KEY) as Record<string, QuotaStore | undefined>
  const stored = result[STORAGE_KEY]
  if (stored && stored.date === todayUtc()) return stored
  return { date: todayUtc(), used: 0 }
}

async function save(store: QuotaStore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: store })
}

/** Record units consumed by an operation. Returns the updated used count. */
export async function recordUnits(units: number): Promise<number> {
  const store = await load()
  store.used += units
  await save(store)
  return store.used
}

/** Return { used, limit, warnThreshold, overLimit, nearLimit }. */
export async function getQuotaStatus(): Promise<{
  used: number
  limit: number
  warnThreshold: number
  overLimit: boolean
  nearLimit: boolean
}> {
  const store = await load()
  return {
    used: store.used,
    limit: DAILY_LIMIT,
    warnThreshold: Math.floor(DAILY_LIMIT * WARN_THRESHOLD),
    overLimit: store.used >= DAILY_LIMIT,
    nearLimit: store.used >= DAILY_LIMIT * WARN_THRESHOLD,
  }
}

/** Reset quota counter (call after confirmed quota exceeded to try again tomorrow). */
export async function resetQuota(): Promise<void> {
  await save({ date: todayUtc(), used: 0 })
}
