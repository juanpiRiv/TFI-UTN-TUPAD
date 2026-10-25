import { setupServer } from 'msw/node'
import { domainHandlers } from './handlers'
import { activityHandlers } from './handlers/activities'
import { authHandlers } from './handlers/auth'
import { pointOfSaleHandlers } from './handlers/points-of-sale'
import { userHandlers } from './handlers/users'

// Tests have no backend, so they also simulate auth and the endpoints that only exist there.
export const server = setupServer(
  ...authHandlers,
  ...userHandlers,
  ...pointOfSaleHandlers,
  ...activityHandlers,
  ...domainHandlers,
)
