import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { API_URL } from '@/lib/api'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'

const client = {
  id: 7,
  organizationId: 1,
  docType: 'CUIT',
  docNumber: '30712345678',
  name: 'Estudio García',
  address: null,
  taxCondition: 'RESPONSABLE_INSCRIPTO',
  email: null,
  phone: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

const invoice = (over: object = {}) => ({
  id: 1,
  voucherType: 'FACTURA_C',
  voucherNumber: null,
  concept: 'SERVICIOS',
  issueDate: '2026-10-24',
  recipientName: 'Estudio García',
  currency: 'ARS',
  totalAmount: '1000.00',
  totalPaid: '0.00',
  pendingBalance: '1000.00',
  status: 'DRAFT',
  commercialStatus: 'PENDING',
  cae: null,
  client: null,
  ...over,
})

const serve = (clients: object[], invoices: object[]) =>
  server.use(
    http.get(`${API_URL}/api/clients`, () => HttpResponse.json(clients)),
    http.get(`${API_URL}/api/invoices`, () => HttpResponse.json(invoices)),
  )

describe('primeros pasos en el inicio (Issue #173)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)
  })

  it('quien recién empieza ve los pasos, con 0 de 5 hechos y un enlace a cada pantalla', async () => {
    serve([], [])
    renderApp('/')

    const panel = await screen.findByRole('region', { name: 'Primeros pasos' })
    expect(within(panel).getByText('0 de 5 pasos')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /datos de tu negocio/i })).toHaveAttribute('href', '/organizacion')
    expect(within(panel).getByRole('link', { name: /primer cliente/i })).toHaveAttribute('href', '/clientes')
    expect(within(panel).getByRole('link', { name: /primera factura/i })).toHaveAttribute('href', '/facturas/nueva')
    expect(within(panel).getByRole('link', { name: /Facturá el borrador|facturala/i })).toHaveAttribute('href', '/facturas')
    expect(within(panel).getByRole('link', { name: /primer cobro/i })).toHaveAttribute('href', '/facturas')
  })

  it('tilda cada paso cuando está hecho y cuenta cuántos van', async () => {
    serve([client], [invoice()])
    renderApp('/')

    const panel = await screen.findByRole('region', { name: 'Primeros pasos' })
    expect(within(panel).getByText('2 de 5 pasos')).toBeInTheDocument()
    expect(within(panel).getByTestId('step-cliente')).toHaveAttribute('data-done', 'true')
    expect(within(panel).getByTestId('step-factura')).toHaveAttribute('data-done', 'true')
    expect(within(panel).getByTestId('step-facturar')).toHaveAttribute('data-done', 'false')
    expect(within(panel).getByTestId('step-cobro')).toHaveAttribute('data-done', 'false')
  })

  it('el paso de facturar y el del cobro se completan con una factura autorizada y cobrada', async () => {
    serve([client], [invoice({ status: 'AUTHORIZED', voucherNumber: 1, totalPaid: '300.00', commercialStatus: 'PARTIALLY_PAID' })])
    renderApp('/')

    const panel = await screen.findByRole('region', { name: 'Primeros pasos' })
    expect(within(panel).getByText('4 de 5 pasos')).toBeInTheDocument()
    expect(within(panel).getByTestId('step-facturar')).toHaveAttribute('data-done', 'true')
    expect(within(panel).getByTestId('step-cobro')).toHaveAttribute('data-done', 'true')
  })

  it('el paso del negocio se completa con el domicilio y el inicio de actividades', async () => {
    const user = seedUser('otra@example.com')
    seedOrganization(user.id, { commercialAddress: 'Av. Siempre Viva 742', activityStartDate: '2020-03-01' })
    loginAs(user.id)
    serve([], [])
    renderApp('/')

    const panel = await screen.findByRole('region', { name: 'Primeros pasos' })
    expect(within(panel).getByTestId('step-negocio')).toHaveAttribute('data-done', 'true')
  })

  it('se puede ocultar y no vuelve a aparecer', async () => {
    serve([], [])
    const view = renderApp('/')

    await view.user.click(await screen.findByRole('button', { name: 'Ocultar' }))

    expect(screen.queryByRole('region', { name: 'Primeros pasos' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('primeros-pasos-ocultos')).toBe('true')
  })

  it('desaparece solo cuando todos los pasos están completos', async () => {
    const user = seedUser('completa@example.com')
    seedOrganization(user.id, { commercialAddress: 'Av. Siempre Viva 742', activityStartDate: '2020-03-01' })
    loginAs(user.id)
    serve([client], [invoice({ status: 'AUTHORIZED', voucherNumber: 1, totalPaid: '1000.00', commercialStatus: 'PAID' })])
    renderApp('/')

    await screen.findByRole('heading', { name: /Dashboard|Resumen/i })
    expect(screen.queryByRole('region', { name: 'Primeros pasos' })).not.toBeInTheDocument()
  })

  it('el formulario del negocio explica qué viene después', async () => {
    window.localStorage.clear()
    const user = seedUser('nueva@example.com')
    loginAs(user.id)
    renderApp('/onboarding')

    expect(await screen.findByText(/Qué sigue/i)).toBeInTheDocument()
    expect(screen.getByText(/cargar clientes/i)).toBeInTheDocument()
  })
})
