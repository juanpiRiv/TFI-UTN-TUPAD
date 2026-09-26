import { clearToken, getToken } from './auth'

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export type FieldErrorDetail = { field: string; message: string }

/** Error shape returned by the backend: `{ error, details? }`. */
export class ApiError extends Error {
  readonly status: number
  readonly details: FieldErrorDetail[]

  constructor(status: number, message: string, details: FieldErrorDetail[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

type QueryValue = string | number | boolean | null | undefined

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, QueryValue>
  signal?: AbortSignal
}

let onUnauthorized: (() => void) | null = null

/** Registers what to do when an authenticated request gets a 401 (logout + go to login). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_URL}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function parseDetails(value: unknown): FieldErrorDetail[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is FieldErrorDetail =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as FieldErrorDetail).field === 'string' &&
      typeof (item as FieldErrorDetail).message === 'string',
  )
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'No se pudo conectar con el servidor')
  }

  const payload = await readJson(response)

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: unknown; details?: unknown }
    const message = typeof body.error === 'string' ? body.error : `Error ${response.status}`
    const apiError = new ApiError(response.status, message, parseDetails(body.details))

    // A 401 on a request that carried a token means the session expired or is invalid.
    // A 401 without a token (e.g. wrong password on login) is just a regular error.
    if (response.status === 401 && token) {
      clearToken()
      onUnauthorized?.()
    }
    throw apiError
  }

  return payload as T
}
