import { setupWorker } from 'msw/browser'
import { domainHandlers } from './handlers'

export const worker = setupWorker(...domainHandlers)

export async function startMockWorker(): Promise<void> {
  await worker.start({
    // Anything without a handler (auth, assets, Vite) goes to the network untouched.
    onUnhandledRequest: 'bypass',
    quiet: false,
  })
}
