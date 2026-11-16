import { fireEvent, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_URL } from '@/lib/api'
import { resetArcaCredentials, seedConfiguredCredential } from '@/mocks/handlers/arca-credential'
import {
  enableArcaDelegation,
  MOCK_PLATFORM_CUIT,
  seedArcaDelegation,
} from '@/mocks/handlers/arca-delegation'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'

const PATH = `${API_URL}/api/organizations/me/arca-delegation`
const NOT_CONNECTED = /Todavía no conectaste tu cuenta con ARCA/
let organizationId: number

beforeEach(() => {
  resetArcaCredentials()
  const user = seedUser('lucia@example.com')
  organizationId = seedOrganization(user.id).id
  loginAs(user.id)
})

const delegationOption = () =>
  screen.findByRole('radio', { name: 'Delegar en nuestra plataforma (recomendado)' })

function seedVerified() {
  seedArcaDelegation(organizationId, {
    status: 'VERIFIED',
    verifiedAt: '2026-11-10T12:00:00.000Z',
    lastCheckedAt: '2026-11-10T12:00:00.000Z',
  })
}

describe('availability', () => {
  it('does not offer the delegation when it is not available', async () => {
    renderApp('/organizacion')

    expect(await screen.findByRole('button', { name: 'Generar solicitud' })).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByText(/Delegar/)).not.toBeInTheDocument()
  })

  it('keeps the own-certificate path when the delegation cannot be queried', async () => {
    server.use(http.get(PATH, () => HttpResponse.json({ message: 'boom' }, { status: 500 })))
    renderApp('/organizacion')

    expect(await screen.findByRole('button', { name: 'Generar solicitud' })).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('offers two options, delegation first and selected', async () => {
    enableArcaDelegation()
    renderApp('/organizacion')

    expect(await delegationOption()).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Usar mi propio certificado' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Verificar conexión' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generar solicitud' })).not.toBeInTheDocument()
  })
})

describe('not started', () => {
  it('shows the steps, the CUIT and never asks for a private key', async () => {
    enableArcaDelegation()
    renderApp('/organizacion')
    await delegationOption()

    const steps = screen.getByRole('list', { name: 'Pasos para delegar en la plataforma' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4)
    expect(within(steps).getByText(/Administrador de Relaciones de Clave Fiscal/)).toBeVisible()
    expect(within(steps).getByText(MOCK_PLATFORM_CUIT)).toBeInTheDocument()
    expect(
      screen.getByText(/clave fiscal nivel 3 y un punto de venta de tipo Web Services/),
    ).toBeVisible()
    expect(screen.getByText(NOT_CONNECTED)).toBeInTheDocument()
    const panel = screen.getByRole('group', { name: 'Delegar en la plataforma' })
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(panel).queryByText(/clave privada|\.key|CSR/i)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/proveedor|servidor|ARCA_|docs\//i)
  })

  it('copies the CUIT', async () => {
    enableArcaDelegation()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { user } = renderApp('/organizacion')
    await delegationOption()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await user.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(writeText).toHaveBeenCalledWith(MOCK_PLATFORM_CUIT)
    expect(await screen.findByText('CUIT copiado.')).toBeInTheDocument()
  })

  it('explains how to copy by hand when the clipboard is missing', async () => {
    enableArcaDelegation()
    const { user } = renderApp('/organizacion')
    await delegationOption()
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    await user.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(await screen.findByText(/No se pudo copiar/)).toBeInTheDocument()
    expect(screen.getByText(MOCK_PLATFORM_CUIT)).toBeVisible()
  })
})

describe('verifying', () => {
  it('connects, shows the date and removes the unconnected note', async () => {
    enableArcaDelegation()
    const { user } = renderApp('/organizacion')
    await delegationOption()

    await user.click(screen.getByRole('button', { name: 'Verificar conexión' }))

    expect(await screen.findByText('Conectado por delegación')).toBeInTheDocument()
    expect(screen.getByText(/Verificado el \d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument()
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver a verificar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /Pasos para delegar/ })).not.toBeInTheDocument()
  })

  it('shows the message of a FAILED check and lets the user try again', async () => {
    enableArcaDelegation()
    let calls = 0
    server.use(
      http.post(`${PATH}/verify`, () => {
        calls += 1
        return HttpResponse.json({
          available: true,
          platformCuit: MOCK_PLATFORM_CUIT,
          status: 'FAILED',
          message: 'Todavía no tenés un punto de venta de tipo Web Services.',
        })
      }),
    )
    const { user } = renderApp('/organizacion')
    await delegationOption()

    await user.click(screen.getByRole('button', { name: 'Verificar conexión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Todavía no tenés un punto de venta de tipo Web Services.',
    )
    expect(screen.getByText(NOT_CONNECTED)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Verificar conexión' }))
    await vi.waitFor(() => expect(calls).toBe(2))
  })

  it('renders a FAILED message as plain text', async () => {
    enableArcaDelegation()
    seedArcaDelegation(organizationId, { status: 'FAILED', message: '<script>alert(1)</script>' })
    renderApp('/organizacion')

    expect(await screen.findByRole('alert')).toHaveTextContent('<script>alert(1)</script>')
    expect(document.querySelector('script')).toBeNull()
  })

  it.each([
    [
      '503',
      () => HttpResponse.json({ message: 'No pudimos verificar ahora.' }, { status: 503 }),
      'No pudimos verificar ahora.',
    ],
    [
      '409',
      () => HttpResponse.json({ error: 'La delegación no está disponible.' }, { status: 409 }),
      'La delegación no está disponible.',
    ],
    [
      'a network error',
      () => HttpResponse.error(),
      'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.',
    ],
  ])('shows an alert on %s and keeps the button usable', async (_name, resolver, text) => {
    enableArcaDelegation()
    server.use(http.post(`${PATH}/verify`, resolver))
    const { user } = renderApp('/organizacion')
    await delegationOption()

    await user.click(screen.getByRole('button', { name: 'Verificar conexión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByRole('button', { name: 'Verificar conexión' })).toBeEnabled()
    expect(document.body.textContent).not.toMatch(/servidor/i)
  })

  it('sends a single request on double click', async () => {
    enableArcaDelegation()
    let posts = 0
    server.use(
      http.post(`${PATH}/verify`, async () => {
        posts += 1
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json({
          available: true,
          platformCuit: MOCK_PLATFORM_CUIT,
          status: 'VERIFIED',
          verifiedAt: '2026-11-10T12:00:00.000Z',
        })
      }),
    )
    const { user } = renderApp('/organizacion')
    await delegationOption()

    await user.dblClick(screen.getByRole('button', { name: 'Verificar conexión' }))

    await screen.findByText('Conectado por delegación')
    expect(posts).toBe(1)
  })

  it('a 401 sends the user to the login', async () => {
    enableArcaDelegation()
    server.use(
      http.post(`${PATH}/verify`, () =>
        HttpResponse.json({ error: 'Token expirado' }, { status: 401 }),
      ),
    )
    const { user } = renderApp('/organizacion')
    await delegationOption()

    await user.click(screen.getByRole('button', { name: 'Verificar conexión' }))

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })
})

describe('connected', () => {
  it('can verify again', async () => {
    enableArcaDelegation()
    seedVerified()
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Volver a verificar' }))

    expect(await screen.findByText('Conectado por delegación')).toBeInTheDocument()
  })

  it('disconnects after an in-page confirmation, and cancelling changes nothing', async () => {
    enableArcaDelegation()
    seedVerified()
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Desconectar' }))
    const group = screen.getByRole('group', { name: 'Confirmar desconexión' })
    await user.click(within(group).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Conectado por delegación')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Desconectar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByRole('button', { name: 'Verificar conexión' })).toBeInTheDocument()
    expect(screen.getByText(NOT_CONNECTED)).toBeInTheDocument()
  })

  it('shows the failure and allows retrying the disconnection', async () => {
    enableArcaDelegation()
    seedVerified()
    let fail = true
    server.use(
      http.delete(PATH, () =>
        fail
          ? HttpResponse.json({ message: 'No pudimos desconectar.' }, { status: 503 })
          : new HttpResponse(null, { status: 204 }),
      ),
    )
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Desconectar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos desconectar.')

    fail = false
    seedArcaDelegation(organizationId, { status: 'NOT_STARTED' })
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('button', { name: 'Verificar conexión' })).toBeInTheDocument()
  })
})

describe('both ways of connecting', () => {
  it('own certificate connected and delegation pending: shows connected, never the unconnected note', async () => {
    enableArcaDelegation()
    seedConfiguredCredential(organizationId)
    renderApp('/organizacion')

    expect(await screen.findByRole('radio', { name: 'Usar mi propio certificado' })).toBeChecked()
    expect(screen.getByText('Conectada')).toBeInTheDocument()
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })

  it('both connected: no unconnected note', async () => {
    enableArcaDelegation()
    seedVerified()
    seedConfiguredCredential(organizationId)
    renderApp('/organizacion')

    expect(await delegationOption()).toBeChecked()
    expect(screen.getByText('Conectado por delegación')).toBeInTheDocument()
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })

  it('only delegation connected: the own certificate path still says nothing contradictory', async () => {
    enableArcaDelegation()
    seedVerified()
    const { user } = renderApp('/organizacion')
    await delegationOption()

    await user.click(screen.getByRole('radio', { name: 'Usar mi propio certificado' }))

    expect(screen.getByRole('button', { name: 'Generar solicitud' })).toBeInTheDocument()
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })

  it('switching keeps the wizard state and does not leak typed text into delegation', async () => {
    enableArcaDelegation()
    const { user } = renderApp('/organizacion')
    await delegationOption()

    await user.click(screen.getByRole('radio', { name: 'Usar mi propio certificado' }))
    await user.click(screen.getByRole('button', { name: 'Generar solicitud' }))
    await screen.findByDisplayValue(/BEGIN CERTIFICATE REQUEST/)
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.click(screen.getByRole('button', { name: 'Ya tengo el certificado' }))
    fireEvent.change(screen.getByLabelText('Pegá el certificado'), {
      target: { value: 'TEXTO-ESCRITO' },
    })

    await user.click(
      screen.getByRole('radio', { name: 'Delegar en nuestra plataforma (recomendado)' }),
    )
    expect(screen.getByLabelText('Pegá el certificado')).not.toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Pegá el certificado' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verificar conexión' })).toBeVisible()

    await user.click(screen.getByRole('radio', { name: 'Usar mi propio certificado' }))
    expect(screen.getByLabelText('Pegá el certificado')).toHaveValue('TEXTO-ESCRITO')
  })

  it('is keyboard operable and has unique ids', async () => {
    enableArcaDelegation()
    const { user } = renderApp('/organizacion')
    const first = await delegationOption()

    first.focus()
    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('radio', { name: 'Usar mi propio certificado' })).toBeChecked()
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })
})
