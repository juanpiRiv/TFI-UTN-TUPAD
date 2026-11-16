import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export const organizationKeys = {
  completeness: ['organization-completeness'] as const,
}

export function useUpdateOrganization() {
  const syncMe = useSyncMe()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: organizationsApi.updateOrganization,
    onSuccess: async (organization) => {
      await queryClient.invalidateQueries({ queryKey: organizationKeys.completeness })
      await syncMe(organization)
    },
  })
}

export function useIssuerCompleteness() {
  return useQuery({
    queryKey: organizationKeys.completeness,
    queryFn: ({ signal }) => organizationsApi.getOrganizationWithCompleteness(signal),
    select: (organization) => organization.issuerCompleteness,
  })
}

export const arcaCredentialKeys = {
  all: ['arca-credential'] as const,
}

export function useArcaCredential() {
  return useQuery({
    queryKey: arcaCredentialKeys.all,
    queryFn: ({ signal }) => organizationsApi.getArcaCredential(signal),
  })
}

function useInvalidateArcaCredential() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: arcaCredentialKeys.all })
}

export function useSaveArcaCredential() {
  const invalidate = useInvalidateArcaCredential()
  return useMutation({ mutationFn: organizationsApi.saveArcaCredential, onSuccess: invalidate })
}

export function useDeleteArcaCredential() {
  const invalidate = useInvalidateArcaCredential()
  return useMutation({ mutationFn: organizationsApi.deleteArcaCredential, onSuccess: invalidate })
}

export function useGenerateArcaCsr() {
  const invalidate = useInvalidateArcaCredential()
  return useMutation({ mutationFn: organizationsApi.generateArcaCsr, onSuccess: invalidate })
}

export function useUploadArcaCertificate() {
  const invalidate = useInvalidateArcaCredential()
  return useMutation({ mutationFn: organizationsApi.uploadArcaCertificate, onSuccess: invalidate })
}

export const arcaDelegationKeys = {
  all: ['arca-delegation'] as const,
}

export function useArcaDelegation() {
  return useQuery({
    queryKey: arcaDelegationKeys.all,
    queryFn: ({ signal }) => organizationsApi.getArcaDelegation(signal),
    // The option is a nice-to-have: when it cannot be queried, the own certificate remains.
    retry: false,
  })
}

export function useVerifyArcaDelegation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: organizationsApi.verifyArcaDelegation,
    onSuccess: (status) => queryClient.setQueryData(arcaDelegationKeys.all, status),
  })
}

export function useDeleteArcaDelegation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: organizationsApi.deleteArcaDelegation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: arcaDelegationKeys.all }),
  })
}
