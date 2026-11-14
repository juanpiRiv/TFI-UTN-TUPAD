import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { resetArcaCredentials } from '@/mocks/handlers/arca-credential'

const CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----'

beforeEach(() => {
  resetArcaCredentials()
  const user = seedUser('lucia@example.com')
  seedOrganization(user.id)
  loginAs(user.id)
})

// Long PEM text typed char by char is slow: paste-like change events are enough here.
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function connect(user: ReturnType<typeof renderApp>['user'], cert = CERT, key = KEY) {
  await screen.findByLabelText('O pegá el certificado')
  fill('O pegá el certificado', cert)
  fill('O pegá la clave privada', key)
  await user.click(screen.getByRole('button', { name: 'Conectar con ARCA' }))
}

describe('ARCA credential card', () => {
  it('shows the disconnected state', async () => {
    renderApp('/organizacion')

    expect(await screen.findByText(/Sin conectar: las facturas se emiten/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desconectar' })).not.toBeInTheDocument()
  })

  it('connects, shows the certificate expiry and clears the private key', async () => {
    const { user } = renderApp('/organizacion')

    await connect(user)

    expect(await screen.findByText('Conectada')).toBeInTheDocument()
    expect(screen.getByText(/El certificado vence el 21\/10\/2028/)).toBeInTheDocument()
    expect(screen.getByLabelText('O pegá la clave privada')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument()
  })

  it('shows the server error as is and still clears the private key', async () => {
    const { user } = renderApp('/organizacion')

    await connect(user, '-----BEGIN CERTIFICATE-----\nEXPIRED\n-----END CERTIFICATE-----')

    expect(await screen.findByText('El certificado está vencido')).toBeInTheDocument()
    expect(screen.getByLabelText('O pegá la clave privada')).toHaveValue('')
    expect(screen.getByText(/Sin conectar/)).toBeInTheDocument()
  })

  it('validates the certificate header locally', async () => {
    const { user } = renderApp('/organizacion')

    await connect(user, 'esto no es un certificado')

    expect(await screen.findByText(/debe incluir BEGIN CERTIFICATE/)).toBeInTheDocument()
    expect(screen.getByText(/Sin conectar/)).toBeInTheDocument()
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
    await screen.findByLabelText('O pegá el certificado')

    await user.upload(
      screen.getByLabelText(/Archivo del certificado/),
      new File([CERT], 'cert.crt', { type: 'application/x-x509-ca-cert' }),
    )

    expect(await screen.findByDisplayValue(/BEGIN CERTIFICATE/)).toBeInTheDocument()
  })

  it('disconnects only after an in-page confirmation', async () => {
    const { user } = renderApp('/organizacion')
    await connect(user)
    await screen.findByText('Conectada')

    await user.click(screen.getByRole('button', { name: 'Desconectar' }))
    const group = within(screen.getByRole('group', { name: 'Confirmar desconexión' }))
    expect(group.getByText('¿Seguro? Se borra el certificado y la clave.')).toBeInTheDocument()

    await user.click(group.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Conectada')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Desconectar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText(/Sin conectar/)).toBeInTheDocument()
  })
})
