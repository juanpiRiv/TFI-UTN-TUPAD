import { ApiError } from '@/lib/api'

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Ocurrió un error inesperado. Probá de nuevo.'
}
