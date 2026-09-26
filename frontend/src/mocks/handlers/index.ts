import type { RequestHandler } from 'msw'

/**
 * Handlers for the endpoints the backend does not implement yet.
 * Auth is not here: in the browser it goes to the real backend (see browser.ts),
 * and tests add the handlers from auth.ts.
 */
export const domainHandlers: RequestHandler[] = []
