import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API_URL } from '@/lib/api'
import { getToken } from '@/lib/auth'
import { db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser, TEST_PASSWORD } from '@/test/fixtures'
import { renderApp } from '@/test/render'

function setup() {
  const user = seedUser('lucia@example.com')
  seedOrganization(user.id)
  loginAs(user.id)
  return user
}

// The page is lazy: wait until each section is rendered before looking inside it.
async function profileSection() {
  return within(await screen.findByRole('region', { name: 'Datos personales' }))
}

async function passwordSection() {
  return within(await screen.findByRole('region', { name: 'Contraseña' }))
}

describe('profile', () => {
  it('is reachable from the main menu', async () => {
    setup()
    const { user, router } = renderApp('/categorias')

    await user.click(await screen.findByRole('link', { name: 'Mi perfil' }))

    expect(await screen.findByRole('heading', { name: 'Mi perfil' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/perfil')
  })

  it('updates the name without asking for the password', async () => {
    const seeded = setup()
    const { user } = renderApp('/perfil')

    await user.type(await screen.findByLabelText('Nombre (opcional)'), 'Lucía Pérez')
    await user.click(screen.getByRole('button', { name: 'Guardar datos' }))

    expect(await screen.findByText('Datos guardados.')).toBeInTheDocument()
    expect(db.users.find((u) => u.id === seeded.id)?.name).toBe('Lucía Pérez')
  })

  it('asks for the current password before sending a new email', async () => {
    setup()
    let called = false
    server.use(
      http.patch(`${API_URL}/api/users/me`, () => {
        called = true
        return HttpResponse.json({})
      }),
    )
    const { user } = renderApp('/perfil')

    const email = await screen.findByLabelText('Email')
    await user.clear(email)
    await user.type(email, 'lucia.nueva@example.com')
    await user.click(screen.getByRole('button', { name: 'Guardar datos' }))

    expect(
      await screen.findByText('Para cambiar el email ingresá tu contraseña actual'),
    ).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('changes the email and keeps the session', async () => {
    setup()
    const { user } = renderApp('/perfil')

    const email = await screen.findByLabelText('Email')
    await user.clear(email)
    await user.type(email, 'lucia.nueva@example.com')
    await user.type((await profileSection()).getByLabelText('Contraseña actual'), TEST_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Guardar datos' }))

    expect(await screen.findByText('Datos guardados.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('lucia.nueva@example.com')
    expect(screen.getByText('lucia.nueva@example.com')).toBeInTheDocument()
    expect(getToken()).not.toBeNull()
  })

  it('shows a wrong current password under the field without logging out', async () => {
    setup()
    const { user, router } = renderApp('/perfil')

    const section = await passwordSection()
    await user.type(section.getByLabelText('Contraseña actual'), 'otra-clave')
    await user.type(section.getByLabelText('Contraseña nueva'), 'clave-nueva-456')
    await user.type(screen.getByLabelText('Repetir contraseña nueva'), 'clave-nueva-456')
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/perfil')
    expect(getToken()).not.toBeNull()
  })

  it('changes the password and clears the form', async () => {
    const seeded = setup()
    const { user } = renderApp('/perfil')

    const current = (await passwordSection()).getByLabelText('Contraseña actual')
    await user.type(current, TEST_PASSWORD)
    await user.type(screen.getByLabelText('Contraseña nueva'), 'clave-nueva-456')
    await user.type(screen.getByLabelText('Repetir contraseña nueva'), 'clave-nueva-456')
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    expect(await screen.findByText('Contraseña actualizada.')).toBeInTheDocument()
    expect(current).toHaveValue('')
    expect(db.users.find((u) => u.id === seeded.id)?.password).toBe('clave-nueva-456')
  })
})
