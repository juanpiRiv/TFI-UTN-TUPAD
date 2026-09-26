import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authKeys } from '@/features/auth/queries'
import { categoryKeys } from '@/features/categories/queries'
import type { Me } from '@/features/auth/schemas'
import * as organizationsApi from './api'
import type { Organization } from './types'

// The organization is part of GET /api/auth/me, so its "query key" is the one of /me.
function useSyncMe() {
  const queryClient = useQueryClient()
  return async (organization: Organization) => {
    queryClient.setQueryData<Me>(authKeys.me(), (me) => (me ? { ...me, organization } : me))
    await queryClient.invalidateQueries({ queryKey: authKeys.me() })
  }
}

export function useCreateOrganization() {
  const syncMe = useSyncMe()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: organizationsApi.createOrganization,
    onSuccess: async (organization) => {
      await syncMe(organization)
      // Creating the organization also creates its default categories.
      await queryClient.invalidateQueries({ queryKey: categoryKeys.all })
    },
  })
}

export function useUpdateOrganization() {
  const syncMe = useSyncMe()
  return useMutation({ mutationFn: organizationsApi.updateOrganization, onSuccess: syncMe })
}
