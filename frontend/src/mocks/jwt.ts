// The mocks never verify signatures: they only read the `sub` claim to know which user is calling.
// Real auth is done by the backend; this is just enough to scope mock data per user.

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  return atob(padded)
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Returns the user id from a `Bearer <jwt>` header, or null if it cannot be read. */
export function userIdFromRequest(request: Request): number | null {
  const [scheme, token] = request.headers.get('Authorization')?.split(' ') ?? []
  if (scheme !== 'Bearer' || !token) return null
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const { sub } = JSON.parse(base64UrlDecode(payload)) as { sub?: string }
    const id = Number(sub)
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

/** Builds an unsigned JWT-shaped token for the test auth handlers. */
export function fakeToken(userId: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({ sub: String(userId) }))
  return `${header}.${payload}.test`
}
