import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { clearToken } from '@/lib/auth'
import { resetDb } from '@/mocks/db'
import { server } from '@/mocks/node'

// Lazy route chunks (Recharts is big) can take a while to load when files run in parallel.
configure({ asyncUtilTimeout: 5000 })

// jsdom does not implement ResizeObserver, which Recharts uses to size the charts.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
  clearToken()
  resetDb()
})

afterAll(() => server.close())
