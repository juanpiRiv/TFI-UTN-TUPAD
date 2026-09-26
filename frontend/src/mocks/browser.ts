import { setupWorker } from 'msw/browser'
import { enablePersistence } from './db'
import { domainHandlers } from './handlers'
import { meOverlayHandler } from './handlers/me-overlay'

export const worker = setupWorker(meOverlayHandler, ...domainHandlers)

export async function startMockWorker(): Promise<void> {
  enablePersistence()
  await worker.start({
    // Anything without a handler (register, login, assets, Vite) goes to the network untouched.
    onUnhandledRequest: 'bypass',
  })
}
