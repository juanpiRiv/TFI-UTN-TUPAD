// Session token storage. The backend returns the JWT in the response body, so we keep it
// in memory and mirror it to localStorage to survive a reload.
// TODO: move to an httpOnly cookie once the backend supports it (see frontend/README.md).

const STORAGE_KEY = 'tfi.session.token'

let memoryToken: string | null = readStoredToken()

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function getToken(): string | null {
  return memoryToken
}

export function setToken(token: string): void {
  memoryToken = token
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // Storage may be unavailable (private mode); the in-memory token still works.
  }
}

export function clearToken(): void {
  memoryToken = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clean up.
  }
}
