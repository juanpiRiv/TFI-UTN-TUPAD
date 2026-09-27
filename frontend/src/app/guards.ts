import type { QueryClient } from '@tanstack/react-query'
import { redirect } from 'react-router'
import { meQueryOptions } from '@/features/auth/queries'
import type { Me } from '@/features/auth/schemas'
import { ApiError } from '@/lib/api'
import { clearToken, getToken } from '@/lib/auth'

/**
 * Route loaders that decide where the user can go:
 * - without a token, only /login and /registro;
 * - with a token but no organization (`organization: null` in /me), only /onboarding;
 * - with an organization, everything except the public and onboarding pages.
 */
export function createGuards(queryClient: QueryClient) {
  async function loadMe(): Promise<Me | null> {
    if (!getToken()) return null
    try {
      return await queryClient.ensureQueryData(meQueryOptions())
    } catch (error) {
      // Invalid token, or the user no longer exists: treat it as logged out.
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
        clearToken()
        return null
      }
      throw error
    }
  }

  return {
    async publicOnly() {
      const me = await loadMe()
      if (me) throw redirect(me.organization ? '/' : '/onboarding')
      return null
    },
    async requireOnboarding() {
      const me = await loadMe()
      if (!me) throw redirect('/login')
      if (me.organization) throw redirect('/')
      return me
    },
    async requireOrganization() {
      const me = await loadMe()
      if (!me) throw redirect('/login')
      if (!me.organization) throw redirect('/onboarding')
      return me
    },
  }
}
