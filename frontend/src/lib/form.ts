import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from './api'

/**
 * Maps a backend error to the form: field errors from `details` go to their fields,
 * and the returned message is shown at the top of the form.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string {
  if (!(error instanceof ApiError)) return 'Ocurrió un error inesperado. Probá de nuevo.'
  for (const detail of error.details) {
    const field = fields.find((name) => name === detail.field)
    if (field) setError(field, { type: 'server', message: detail.message })
  }
  return error.message
}
