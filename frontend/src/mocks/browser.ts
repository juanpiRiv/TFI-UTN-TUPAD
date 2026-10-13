import { setupWorker } from 'msw/browser'
import { enablePersistence } from './db'
import { domainHandlers } from './handlers'
import { meOverlayHandler } from './handlers/me-overlay'
import { transactionHandlers } from './handlers/transactions'

// In the browser, transactions are handled by the real backend on localhost:3000.
const browserHandlers = domainHandlers.filter((h) => !transactionHandlers.includes(h))

export const worker = setupWorker(meOverlayHandler, ...browserHandlers)

export async function startMockWorker(): Promise<void> {
  enablePersistence()
  await worker.start({
    // Anything without a handler (register, login, transactions, assets, Vite) goes to the network untouched.
    onUnhandledRequest: 'bypass',
  })
}
