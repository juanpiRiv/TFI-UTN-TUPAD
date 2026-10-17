import { setupWorker } from 'msw/browser'
import { enablePersistence } from './db'
import { domainHandlers } from './handlers'
import { meOverlayHandler } from './handlers/me-overlay'
import { transactionHandlers } from './handlers/transactions'
import { dashboardHandlers } from './handlers/dashboard'
import { clientHandlers } from './handlers/clients'
import { exchangeRateHandlers } from './handlers/exchange-rates'

// In the browser, transactions, dashboard, clients and exchange-rates are handled by the real backend on localhost:3000.
const excluded = new Set<unknown>([
  ...transactionHandlers,
  ...dashboardHandlers,
  ...clientHandlers,
  ...exchangeRateHandlers,
])
const browserHandlers = domainHandlers.filter((h) => !excluded.has(h))

export const worker = setupWorker(meOverlayHandler, ...browserHandlers)

export async function startMockWorker(): Promise<void> {
  enablePersistence()
  await worker.start({
    // Anything without a handler (register, login, transactions, assets, Vite) goes to the network untouched.
    onUnhandledRequest: 'bypass',
  })
}
