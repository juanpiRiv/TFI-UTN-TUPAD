import { setupServer } from 'msw/node'
import { domainHandlers } from './handlers'
import { authHandlers } from './handlers/auth'

// Tests have no backend, so they also simulate auth.
export const server = setupServer(...authHandlers, ...domainHandlers)
