import type { User } from '@/features/auth/schemas'
import type { Organization } from '@/features/organizations/types'

/** Users only exist in tests: in the browser, auth is handled by the real backend. */
export type MockUser = User & { password: string }

export type MockDb = {
  lastId: number
  users: MockUser[]
  organizations: Organization[]
}

const STORAGE_KEY = 'tfi.mocks.db'

function emptyDb(): MockDb {
  return { lastId: 0, users: [], organizations: [] }
}

let persist = false

/** In-memory data shared by the mock handlers. */
export let db: MockDb = emptyDb()

/** Browser only: keep mock data in localStorage so it survives a reload. */
export function enablePersistence(): void {
  persist = true
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) db = { ...emptyDb(), ...(JSON.parse(stored) as Partial<MockDb>) }
  } catch {
    db = emptyDb()
  }
}

export function saveDb(): void {
  if (!persist) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // Storage full or blocked: the data stays in memory until the reload.
  }
}

export function resetDb(): void {
  db = emptyDb()
  saveDb()
}

export function nextId(): number {
  db.lastId += 1
  return db.lastId
}

export function nowIso(): string {
  return new Date().toISOString()
}
