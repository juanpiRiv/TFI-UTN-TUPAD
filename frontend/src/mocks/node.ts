import { setupServer } from 'msw/node'
import { domainHandlers } from './handlers'

export const server = setupServer(...domainHandlers)
