import { apiFetch } from '@/lib/api'
import type { AuthResponse, LoginInput, Me, RegisterInput } from './schemas'

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/login', { method: 'POST', body: input })
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/register', { method: 'POST', body: input })
}

export function fetchMe(signal?: AbortSignal): Promise<Me> {
  return apiFetch<Me>('/api/auth/me', { signal })
}
