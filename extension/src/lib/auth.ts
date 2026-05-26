// OAuth via chrome.identity.getAuthToken.
// No client_secret is needed — Chrome Extension OAuth clients authenticate
// using only the client_id bound to the extension ID.

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/** Get a valid access token interactively (prompts account picker on first use). */
export async function getToken(interactive = true): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'getAuthToken failed'))
      } else {
        resolve(token)
      }
    })
  })
}

/** Remove a cached token so the next getToken() call fetches a fresh one. */
export async function removeCachedToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve())
  })
}

/** Sign out: remove cached token from Chrome and revoke it with Google. */
export async function signOut(): Promise<void> {
  let token: string | null = null
  try {
    token = await getToken(false)
  } catch {
    // Not signed in — nothing to do.
    return
  }
  await removeCachedToken(token)
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`)
  } catch {
    // Best-effort revoke; ignore network errors.
  }
}
