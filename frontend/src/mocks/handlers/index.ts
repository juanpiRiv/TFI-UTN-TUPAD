import type { RequestHandler } from 'msw'
import { categoryHandlers } from './categories'
import { clientHandlers } from './clients'
import { dashboardHandlers } from './dashboard'
import { exchangeRateHandlers } from './exchange-rates'
import { organizationHandlers } from './organizations'
import { transactionHandlers } from './transactions'

/**
 * Handlers for endpoints used in Vitest unit/integration testing without a running backend.
 * In the browser, real endpoints are consumed unless VITE_MOCK_MODULES is explicitly set.
 */
export const domainHandlers: RequestHandler[] = [
  ...organizationHandlers,
  ...clientHandlers,
  ...categoryHandlers,
  ...transactionHandlers,
  ...exchangeRateHandlers,
  ...dashboardHandlers,
]
