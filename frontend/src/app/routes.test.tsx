import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'

describe('route guards', () => {
  it('sends a visitor without a token to the login', async () => {
    const { router } = renderApp('/movimientos')

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('treats a rejected token as logged out', async () => {
    loginAs(999)
    const { router } = renderApp('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('sends a user without an organization to the onboarding', async () => {
    const user = seedUser()
    loginAs(user.id)
    const { router } = renderApp('/clientes')

    expect(
      await screen.findByRole('heading', { name: 'Contanos de tu actividad' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding')
  })

  it('lets a user with an organization in, and keeps them out of the onboarding', async () => {
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)
    const { router } = renderApp('/onboarding')

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('completes the onboarding and lands on the dashboard', async () => {
    const account = seedUser()
    loginAs(account.id)
    const { user, router } = renderApp('/onboarding')

    await user.type(await screen.findByLabelText('CUIT'), '20-12345678-6')
    await user.type(screen.getByLabelText('Razón social o nombre y apellido'), 'Lucía Pérez')
    await user.click(screen.getByRole('button', { name: 'Crear organización' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
