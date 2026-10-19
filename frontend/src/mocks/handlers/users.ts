import { http, HttpResponse } from 'msw'
import { API_URL } from '@/lib/api'
import { db, nowIso, saveDb } from '../db'
import { userIdFromRequest } from '../jwt'

const wrongPassword = () =>
  HttpResponse.json(
    {
      error: 'invalid Data',
      details: [{ field: 'currentPassword', message: 'Current password is incorrect' }],
    },
    { status: 400 },
  )

export const userHandlers = [
  http.patch(`${API_URL}/api/users/me`, async ({ request }) => {
    const userId = userIdFromRequest(request)
    if (!userId) return HttpResponse.json({ error: 'Invalid Token' }, { status: 401 })
    const user = db.users.find((candidate) => candidate.id === userId)
    if (!user) return HttpResponse.json({ error: 'User not found' }, { status: 404 })

    const body = (await request.json()) as {
      name?: string | null
      email?: string
      currentPassword?: string
    }

    if (body.email !== undefined && body.email !== user.email) {
      if (body.currentPassword !== user.password) return wrongPassword()
      if (db.users.some((other) => other.email === body.email)) {
        return HttpResponse.json({ error: 'Email already register' }, { status: 409 })
      }
      user.email = body.email
    }
    if (body.name !== undefined) user.name = body.name
    saveDb()

    return HttpResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: nowIso(),
    })
  }),

  http.patch(`${API_URL}/api/users/me/password`, async ({ request }) => {
    const userId = userIdFromRequest(request)
    if (!userId) return HttpResponse.json({ error: 'Invalid Token' }, { status: 401 })
    const user = db.users.find((candidate) => candidate.id === userId)
    if (!user) return HttpResponse.json({ error: 'User not found' }, { status: 404 })

    const body = (await request.json()) as { currentPassword: string; newPassword: string }
    if (body.currentPassword !== user.password) return wrongPassword()

    user.password = body.newPassword
    saveDb()
    return new HttpResponse(null, { status: 204 })
  }),
]
