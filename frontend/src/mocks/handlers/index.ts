import type { RequestHandler } from 'msw'
import { categoryHandlers } from './categories'
import { clientHandlers } from './clients'
import { dashboardHandlers } from './dashboard'
import { exchangeRateHandlers } from './exchange-rates'
import { organizationHandlers } from './organizations'
import { transactionHandlers } from './transactions'

/**
 * Handlers for the endpoints the backend does not implement yet.
 * Auth is not here: in the browser it goes to the real backend (see browser.ts),
 * and tests add the handlers from auth.ts.
 */
export const domainHandlers: RequestHandler[] = [
  ...organizationHandlers,
  ...clientHandlers,
  ...categoryHandlers,
  ...transactionHandlers,
  ...exchangeRateHandlers,
  ...dashboardHandlers,
]
