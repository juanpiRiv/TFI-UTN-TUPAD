import { ApiError } from '@/lib/api'

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Ocurrió un error inesperado. Probá de nuevo.'
}

/** Like `errorMessage`, but without technical wording for the delegation panel. */
export function delegationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 0
      ? 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.'
      : error.message
  }
  return 'Ocurrió un error inesperado. Probá de nuevo.'
}
