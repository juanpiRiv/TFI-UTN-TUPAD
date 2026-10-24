import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authKeys } from '@/features/auth/queries'
import type { Me } from '@/features/auth/schemas'
import * as profileApi from './api'

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: profileApi.updateProfile,
    onSuccess: (user) => {
      queryClient.setQueryData<Me>(authKeys.me(), (me) =>
        me ? { ...me, name: user.name, email: user.email } : me,
      )
    },
  })
}

export function useChangePassword() {
  return useMutation({ mutationFn: profileApi.changePassword })
}
