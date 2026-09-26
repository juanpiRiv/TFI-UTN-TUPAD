import { http, HttpResponse } from 'msw'
import { API_URL } from '@/lib/api'
import { db, nextId, nowIso, saveDb } from '../db'
import { fakeToken, userIdFromRequest } from '../jwt'

/**
 * Test-only copy of the real auth endpoints (backend/src/module/auth), with the same
 * status codes and error bodies. The browser never uses these: auth goes to the backend.
 */
export const authHandlers = [
  http.post(`${API_URL}/api/auth/register`, async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string }
    if (db.users.some((user) => user.email === email)) {
      return HttpResponse.json({ error: 'Email already register' }, { status: 409 })
    }
    const user = { id: nextId(), email, password, createdAt: nowIso() }
    db.users.push(user)
    saveDb()
    return HttpResponse.json(
      { user: { id: user.id, email, createdAt: user.createdAt }, token: fakeToken(user.id) },
      { status: 201 },
    )
  }),

  http.post(`${API_URL}/api/auth/login`, async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string }
    const user = db.users.find((candidate) => candidate.email === email)
    if (!user || user.password !== password) {
      return HttpResponse.json({ error: 'Email or password wrong' }, { status: 401 })
    }
    return HttpResponse.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
      token: fakeToken(user.id),
    })
  }),

  http.get(`${API_URL}/api/auth/me`, ({ request }) => {
    const userId = userIdFromRequest(request)
    if (!userId) return HttpResponse.json({ error: 'Invalid Token' }, { status: 401 })
    const user = db.users.find((candidate) => candidate.id === userId)
    if (!user) return HttpResponse.json({ error: 'User not found' }, { status: 404 })
    const organization = db.organizations.find((org) => org.userId === userId) ?? null
    return HttpResponse.json({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      organization,
    })
  }),
]
