import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API_URL } from '@/lib/api'
import { getToken } from '@/lib/auth'
import { server } from '@/mocks/node'
import { seedUser, TEST_PASSWORD } from '@/test/fixtures'
import { renderApp } from '@/test/render'

describe('login', () => {
  it('validates the form before calling the backend', async () => {
    let called = false
    server.use(
      http.post(`${API_URL}/api/auth/login`, () => {
        called = true
        return HttpResponse.json({})
      }),
    )
    const { user } = renderApp('/login')

    await user.click(await screen.findByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('Ingresá un email válido')).toBeInTheDocument()
    expect(screen.getByText('Ingresá tu contraseña')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('shows the error returned by the backend', async () => {
    seedUser('lucia@example.com')
    const { user } = renderApp('/login')

    await user.type(await screen.findByLabelText('Email'), 'lucia@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'otra-clave')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('Email or password wrong')).toBeInTheDocument()
    expect(getToken()).toBeNull()
  })

  it('shows field errors from the backend details', async () => {
    server.use(
      http.post(`${API_URL}/api/auth/login`, () =>
        HttpResponse.json(
          { error: 'invalid Data', details: [{ field: 'email', message: 'Invalid Email' }] },
          { status: 400 },
        ),
      ),
    )
    const { user } = renderApp('/login')

    await user.type(await screen.findByLabelText('Email'), 'lucia@example.com')
    await user.type(screen.getByLabelText('Contraseña'), TEST_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('invalid Data')).toBeInTheDocument()
    expect(screen.getByText('Invalid Email')).toBeInTheDocument()
  })

  it('stores the token and sends a new user to the onboarding', async () => {
    seedUser('lucia@example.com')
    const { user, router } = renderApp('/login')

    await user.type(await screen.findByLabelText('Email'), 'lucia@example.com')
    await user.type(screen.getByLabelText('Contraseña'), TEST_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(
      await screen.findByRole('heading', { name: 'Contanos de tu actividad' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding')
    expect(getToken()).not.toBeNull()
  })
})

describe('register', () => {
  it('checks that both passwords match', async () => {
    const { user } = renderApp('/registro')

    await user.type(await screen.findByLabelText('Email'), 'nuevo@example.com')
    await user.type(screen.getByLabelText('Contraseña'), TEST_PASSWORD)
    await user.type(screen.getByLabelText('Repetí la contraseña'), 'distinta-123')
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument()
  })
})
