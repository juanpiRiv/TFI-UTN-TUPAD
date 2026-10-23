import type { RequestHandler } from 'msw'
import { setupWorker } from 'msw/browser'
import { enablePersistence } from './db'
import { categoryHandlers } from './handlers/categories'
import { clientHandlers } from './handlers/clients'
import { dashboardHandlers } from './handlers/dashboard'
import { exchangeRateHandlers } from './handlers/exchange-rates'
import { meOverlayHandler } from './handlers/me-overlay'
import { organizationHandlers } from './handlers/organizations'
import { transactionHandlers } from './handlers/transactions'

/**
 * Handlers mapped by module.
 * Note: 'organizations' and 'me-overlay' are coupled together because mock clients and
 * mock transactions draw the active organization from the mock context.
 */
const MODULE_HANDLERS: Record<string, RequestHandler[]> = {
  organizations: [...organizationHandlers, meOverlayHandler],
  'me-overlay': [meOverlayHandler],
  categories: categoryHandlers,
  clients: clientHandlers,
  transactions: transactionHandlers,
  dashboard: dashboardHandlers,
  'exchange-rates': exchangeRateHandlers,
}

function resolveActiveHandlers(): RequestHandler[] {
  const envModules = import.meta.env.VITE_MOCK_MODULES
  if (!envModules || envModules.trim() === '') {
    return []
  }

  const requested = envModules
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean)

  if (requested.includes('all')) {
    return Object.values(MODULE_HANDLERS).flat()
  }

  const handlers: RequestHandler[] = []
  for (const mod of requested) {
    if (MODULE_HANDLERS[mod]) {
      handlers.push(...MODULE_HANDLERS[mod])
    }
  }
  return handlers
}

export const worker = setupWorker(...resolveActiveHandlers())

export async function startMockWorker(): Promise<void> {
  const handlers = resolveActiveHandlers()
  if (handlers.length === 0) {
    return
  }
  enablePersistence()
  await worker.start({
    // Anything without an active handler goes to the network untouched.
    onUnhandledRequest: 'bypass',
  })
}

