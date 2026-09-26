import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { clearToken, setToken } from '@/lib/auth'
import * as authApi from './api'
import type { AuthResponse } from './schemas'

export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
}

export const meQueryOptions = () =>
  queryOptions({
    queryKey: authKeys.me(),
    queryFn: ({ signal }) => authApi.fetchMe(signal),
    staleTime: 5 * 60_000,
  })

/** Current user. Only used below the private routes, where the loader already fetched it. */
export function useMe() {
  return useQuery(meQueryOptions())
}

/** The organization of the logged-in user. Private routes guarantee it exists. */
export function useOrganization() {
  const { data } = useMe()
  if (!data?.organization) throw new Error('La organización todavía no está cargada')
  return data.organization
}

function useStartSession() {
  const queryClient = useQueryClient()
  return ({ token }: AuthResponse) => {
    // Drop anything cached from a previous session before using the new token.
    queryClient.clear()
    setToken(token)
  }
}

export function useLogin() {
  const startSession = useStartSession()
  return useMutation({ mutationFn: authApi.login, onSuccess: startSession })
}

export function useRegister() {
  const startSession = useStartSession()
  return useMutation({ mutationFn: authApi.register, onSuccess: startSession })
}

export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return () => {
    clearToken()
    queryClient.clear()
    void navigate('/login', { replace: true })
  }
}
