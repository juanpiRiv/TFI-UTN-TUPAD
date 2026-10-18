import type { User } from '@/features/auth/schemas'
import { apiFetch } from '@/lib/api'
import type { ChangePasswordInput, UpdateProfileInput } from './schemas'

export function updateProfile(input: UpdateProfileInput): Promise<User> {
  return apiFetch<User>('/api/users/me', { method: 'PATCH', body: input })
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await apiFetch<null>('/api/users/me/password', { method: 'PATCH', body: input })
}
