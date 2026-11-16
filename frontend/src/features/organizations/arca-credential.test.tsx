import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { resetArcaCredentials, seedPendingCsr } from '@/mocks/handlers/arca-credential'
import { API_URL } from '@/lib/api'
import { server } from '@/mocks/node'
import { http, HttpResponse } from 'msw'

const CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----'

let organizationId: number

beforeEach(() => {
  resetArcaCredentials()
  const user = seedUser('lucia@example.com')
  organizationId = seedOrganization(user.id).id
  loginAs(user.id)
})

// Long PEM text typed char by char is slow: paste-like change events are enough here.
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function connect(user: ReturnType<typeof renderApp>['user'], cert = CERT, key = KEY) {
  await user.click(await screen.findByText('Opciones avanzadas'))
  await screen.findByLabelText('O pegá el certificado')
  fill('O pegá el certificado', cert)
  fill('O pegá la clave privada', key)
  await user.click(screen.getByRole('button', { name: 'Conectar con ARCA' }))
}

const wizardCert = '-----BEGIN CERTIFICATE-----\nWIZARD\n-----END CERTIFICATE-----'

describe('ARCA connection wizard', () => {
  it('guides the three steps and ends connected, never asking for a private key', async () => {
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Generar solicitud' }))
    expect(await screen.findByDisplayValue(/BEGIN CERTIFICATE REQUEST/)).toBeInTheDocument()
    expect(screen.getByLabelText('Solicitud de certificado (CSR)')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument()
    const download = screen.getByRole('link', { name: 'Descargar .csr' })
    expect(download).toHaveAttribute('download', 'solicitud-arca.csr')

    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getAllByText(/WSASS/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/wsfe/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/alta-de-cliente|docs\//)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ya tengo el certificado' }))
    const form = within(screen.getByRole('form', { name: 'Subir el certificado' }))
    expect(form.queryByLabelText(/clave privada/i)).not.toBeInTheDocument()
    fill('Pegá el certificado', wizardCert)
    await user.click(form.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByText('Conectada')).toBeInTheDocument()
    expect(screen.getByText(/El certificado vence el 21\/10\/2028/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reemplazar' })).toBeInTheDocument()
  })

  it('copies the request to the clipboard', async () => {
    seedPendingCsr(organizationId)
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { user } = renderApp('/organizacion')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await user.click(await screen.findByRole('button', { name: 'Copiar' }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('PENDIENTE'))
    expect(await screen.findByText('Copiado al portapapeles.')).toBeInTheDocument()
  })

  it('resumes on step 2 when a request is pending and can generate a new one', async () => {
    seedPendingCsr(organizationId)
    const { user } = renderApp('/organizacion')

    expect((await screen.findAllByText(/WSASS/)).length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue(/PENDIENTE/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Generar una nueva solicitud' }))
    expect(await screen.findByDisplayValue(/NUEVA/)).toBeInTheDocument()
  })

  it('shows the 422 message of the server and stays on the upload step', async () => {
    seedPendingCsr(organizationId)
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Ya tengo el certificado' }))
    fill('Pegá el certificado', '-----BEGIN CERTIFICATE-----\nOTRO-CUIT\n-----END CERTIFICATE-----')
    await user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(
      await screen.findByText('El certificado no corresponde al CUIT de tu negocio.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Todavía no conectaste tu cuenta con ARCA/)).toBeInTheDocument()
  })

  it('shows the 503 message when the server cannot store keys', async () => {
    server.use(
      http.post(`${API_URL}/api/organizations/me/arca-credential/csr`, () =>
        HttpResponse.json({ message: 'El servidor no tiene clave de cifrado.' }, { status: 503 }),
      ),
    )
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Generar solicitud' }))

    expect(await screen.findByText('El servidor no tiene clave de cifrado.')).toBeInTheDocument()
  })

  it('replacing starts the wizard again and can be cancelled', async () => {
    const { user } = renderApp('/organizacion')
    await connect(user)
    await screen.findByText('Conectada')

    await user.click(screen.getByRole('button', { name: 'Reemplazar' }))
    expect(screen.getByRole('button', { name: 'Generar solicitud' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Conectada')).toBeInTheDocument()
  })
})

describe('Datos para facturar', () => {
  it('lists what is missing and focuses the field', async () => {
    const { user } = renderApp('/organizacion')

    expect(await screen.findByRole('heading', { name: 'Datos para facturar' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Completar Domicilio comercial' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Completar Domicilio comercial' }))
    expect(document.getElementById('commercialAddress')).toHaveFocus()
  })

  it('says it is complete when nothing is missing', async () => {
    server.use(
      http.get(`${API_URL}/api/organizations/me`, () =>
        HttpResponse.json({ id: 1, issuerCompleteness: { complete: true, missing: [] } }),
      ),
    )
    renderApp('/organizacion')

    expect(await screen.findByText(/datos están completos/)).toBeInTheDocument()
  })
})

describe('ARCA credential card', () => {
  it('shows the disconnected state', async () => {
    renderApp('/organizacion')

    expect(await screen.findByText(/Todavía no conectaste tu cuenta con ARCA/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
  })

  it('connects, shows the certificate expiry and clears the private key', async () => {
    const { user } = renderApp('/organizacion')

    await connect(user)

    expect(await screen.findByText('Conectada')).toBeInTheDocument()
    expect(screen.getByText(/El certificado vence el 21\/10\/2028/)).toBeInTheDocument()
    expect(screen.queryByLabelText('O pegá la clave privada')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
  })

  it('shows the server error as is and still clears the private key', async () => {
    const { user } = renderApp('/organizacion')

    await connect(user, '-----BEGIN CERTIFICATE-----\nEXPIRED\n-----END CERTIFICATE-----')

    expect(await screen.findByText('El certificado está vencido')).toBeInTheDocument()
    expect(screen.getByLabelText('O pegá la clave privada')).toHaveValue('')
    expect(screen.getByText(/Todavía no conectaste tu cuenta con ARCA/)).toBeInTheDocument()
  })

  it('validates the certificate header locally', async () => {
    const { user } = renderApp('/organizacion')

    await connect(user, 'esto no es un certificado')

    expect(await screen.findByText(/debe incluir BEGIN CERTIFICATE/)).toBeInTheDocument()
    expect(screen.getByText(/Todavía no conectaste tu cuenta con ARCA/)).toBeInTheDocument()
  })

  it('rejects encrypted private keys locally', async () => {
    const { user } = renderApp('/organizacion')

    await connect(
      user,
      CERT,
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIE\n-----END ENCRYPTED PRIVATE KEY-----',
    )

    expect(await screen.findByText(/protegida con contraseña/)).toBeInTheDocument()
  })

  it('reads the certificate from a file', async () => {
    const { user } = renderApp('/organizacion')
    await user.click(await screen.findByText('Opciones avanzadas'))

    await user.upload(
      screen.getByLabelText(/Archivo del certificado \(\.crt, \.pem, \.cer\)/),
      new File([CERT], 'cert.crt', { type: 'application/x-x509-ca-cert' }),
    )

    expect(await screen.findByDisplayValue(/BEGIN CERTIFICATE/)).toBeInTheDocument()
  })

  it('disconnects only after an in-page confirmation', async () => {
    const { user } = renderApp('/organizacion')
    await connect(user)
    await screen.findByText('Conectada')

    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    const group = within(screen.getByRole('group', { name: 'Confirmar eliminación' }))
    expect(group.getByText('¿Seguro? Se borra el certificado y la clave.')).toBeInTheDocument()

    await user.click(group.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Conectada')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText(/Todavía no conectaste tu cuenta con ARCA/)).toBeInTheDocument()
  })
})
