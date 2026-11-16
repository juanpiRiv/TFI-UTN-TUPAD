import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorMessage } from '@/features/organizations/arca-errors'
import { API_URL, ApiError, apiFetch, setUnauthorizedHandler } from '@/lib/api'
import { setToken } from '@/lib/auth'
import { server } from '@/mocks/node'

const URL = `${API_URL}/api/probe`

async function failure(reply: () => Response): Promise<ApiError> {
  server.use(http.get(URL, reply))
  const error = await apiFetch('/api/probe').then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

afterEach(() => setUnauthorizedHandler(null))

describe('ApiError', () => {
  it('reads `error`', async () => {
    const error = await failure(() => HttpResponse.json({ error: 'Por error' }, { status: 400 }))
    expect(error.message).toBe('Por error')
    expect(error.status).toBe(400)
  })

  it('reads `message`', async () => {
    const error = await failure(() =>
      HttpResponse.json({ message: 'Por mensaje' }, { status: 422 }),
    )
    expect(error.message).toBe('Por mensaje')
  })

  it('prefers `error` when both are present', async () => {
    const error = await failure(() =>
      HttpResponse.json({ error: 'A', message: 'B' }, { status: 422 }),
    )
    expect(error.message).toBe('A')
  })

  it.each([
    ['an empty `error`', { error: '' }],
    ['a non-string `error`', { error: { nested: true } }],
    ['a null `message`', { message: null }],
    ['an empty `message`', { message: '' }],
    ['an empty object', {}],
  ])('falls back to "Error <status>" with %s', async (_name, body) => {
    const error = await failure(() => HttpResponse.json(body, { status: 418 }))
    expect(error.message).toBe('Error 418')
  })

  it('falls back to a usable `message` when `error` is empty', async () => {
    const error = await failure(() =>
      HttpResponse.json({ error: '', message: 'Sirve' }, { status: 400 }),
    )
    expect(error.message).toBe('Sirve')
  })

  it('exposes the code and the whole raw body', async () => {
    const body = { message: 'x', code: 'ISSUER_INCOMPLETE', missing: ['cuit'], extra: { a: 1 } }
    const error = await failure(() => HttpResponse.json(body, { status: 422 }))
    expect(error.code).toBe('ISSUER_INCOMPLETE')
    expect(error.body).toEqual(body)
  })

  it('ignores a non-string code', async () => {
    const error = await failure(() => HttpResponse.json({ message: 'x', code: 7 }, { status: 422 }))
    expect(error.code).toBeNull()
  })

  it('keeps only well-formed field details', async () => {
    const error = await failure(() =>
      HttpResponse.json(
        {
          error: 'invalid Data',
          details: [{ field: 'cuit', message: 'Mal' }, { field: 1 }, 'x', null],
        },
        { status: 400 },
      ),
    )
    expect(error.details).toEqual([{ field: 'cuit', message: 'Mal' }])
  })

  it.each([
    ['an HTML body', () => new HttpResponse('<html>Bad Gateway</html>', { status: 502 }), 502],
    ['plain text', () => new HttpResponse('upstream down', { status: 503 }), 503],
    ['an empty body', () => new HttpResponse(null, { status: 500 }), 500],
    ['a broken JSON', () => new HttpResponse('{"error": "cortado', { status: 500 }), 500],
  ])('survives %s with a generic message and an empty body', async (_name, reply, status) => {
    const error = await failure(reply)
    expect(error.message).toBe(`Error ${status}`)
    expect(error.status).toBe(status)
    expect(error.code).toBeNull()
    expect(error.details).toEqual([])
    expect(error.body).toEqual({})
  })

  it.each([
    ['a JSON string', '"oops"'],
    ['a JSON array', '[1,2]'],
    ['JSON null', 'null'],
    ['a JSON number', '42'],
  ])('keeps `body` an object when the server sends %s', async (_name, raw) => {
    const error = await failure(
      () => new HttpResponse(raw, { status: 500, headers: { 'Content-Type': 'application/json' } }),
    )
    expect(error.message).toBe('Error 500')
    expect(error.body).toEqual({})
  })

  it('a network failure becomes status 0 with a readable message', async () => {
    const error = await failure(() => HttpResponse.error())
    expect(error.status).toBe(0)
    expect(error.message).toBe('No se pudo conectar con el servidor')
  })

  it('an empty success body resolves to null instead of throwing', async () => {
    server.use(http.get(URL, () => new HttpResponse(null, { status: 204 })))
    await expect(apiFetch('/api/probe')).resolves.toBeNull()
  })
})

describe('401 handling', () => {
  it('with a token it clears the session and calls the unauthorized handler once', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    setToken('token-viejo')

    const error = await failure(() =>
      HttpResponse.json({ error: 'Token expirado' }, { status: 401 }),
    )

    expect(error.message).toBe('Token expirado')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('without a token (wrong password) it is a regular error', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    await failure(() => HttpResponse.json({ error: 'Credenciales inválidas' }, { status: 401 }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('other statuses with a token never trigger it', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    setToken('token')

    await failure(() => HttpResponse.json({ error: 'Prohibido' }, { status: 403 }))

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('errorMessage (ARCA screens)', () => {
  it('uses the ApiError message', () => {
    expect(errorMessage(new ApiError(422, 'Mensaje del servidor'))).toBe('Mensaje del servidor')
  })

  it.each([[new Error('interno con datos')], ['string'], [undefined], [null]])(
    'never leaks the text of an unexpected error (%s)',
    (value) => {
      expect(errorMessage(value)).toBe('Ocurrió un error inesperado. Probá de nuevo.')
    },
  )
})
