import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_URL } from '@/lib/api'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import type { InvoiceDetail } from './schemas'

const draft: InvoiceDetail = {
  invoiceId: 1,
  voucherType: 'FACTURA_C',
  voucherNumber: null,
  status: 'DRAFT',
  currency: 'ARS',
  issueDate: '2026-10-24',
  concept: 'PRODUCTOS',
  cae: null,
  recipientName: 'Estudio García',
  client: { id: 7, name: 'Estudio García' },
  totalAmount: '215.02',
  totalPaid: '0.00',
  pendingBalance: '215.02',
  commercialStatus: 'PENDING',
  payments: [],
}
const authorized: InvoiceDetail = {
  ...draft,
  status: 'AUTHORIZED',
  voucherNumber: 1,
  cae: '74123456789012',
  simulated: true,
}

const fiscal = (over: object = {}) => ({
  outcome: 'AUTHORIZED',
  simulated: true,
  observations: [],
  errors: [],
  ...over,
})

describe('botón Facturar de un borrador (Issue #59)', () => {
  let current: InvoiceDetail
  let posts: number

  beforeEach(() => {
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)
    current = draft
    posts = 0
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    server.use(http.get(`${API_URL}/api/invoices/1`, () => HttpResponse.json(current)))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mockAuthorize = (invoice: InvoiceDetail, body: object, status = 200) =>
    server.use(
      http.post(`${API_URL}/api/invoices/1/authorize`, () => {
        posts += 1
        current = invoice
        return HttpResponse.json({ invoice, fiscal: fiscal(body) }, { status })
      }),
    )

  it('un borrador muestra el botón Facturar y no el formulario de cobro', async () => {
    renderApp('/facturas/1')

    expect(await screen.findByRole('button', { name: 'Facturar' })).toBeInTheDocument()
    expect(screen.getByText('Borrador')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Registrar nuevo cobro' })).not.toBeInTheDocument()
  })

  it('al confirmar pide la autorización y muestra el CAE y el aviso de comprobante simulado', async () => {
    mockAuthorize(authorized, {})
    const view = renderApp('/facturas/1')

    await view.user.click(await screen.findByRole('button', { name: 'Facturar' }))

    expect(await screen.findByText(/Factura autorizada/)).toBeInTheDocument()
    expect(screen.getByText(/sin validez fiscal/i)).toBeInTheDocument()
    expect(screen.getAllByText(/74123456789012/).length).toBeGreaterThan(0)
    expect(posts).toBe(1)
    // Ya autorizada: aparece el formulario de cobro y desaparece el botón
    expect(await screen.findByRole('heading', { name: 'Registrar nuevo cobro' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Facturar' })).not.toBeInTheDocument()
  })

  it('una factura autorizada muestra los datos del emisor del momento de la autorización', async () => {
    current = {
      ...authorized,
      issuer: { cuit: '20000000001', legalName: 'Recorrido SAS', taxCondition: 'MONOTRIBUTO' },
    }
    renderApp('/facturas/1')

    expect(await screen.findByTestId('invoice-issuer')).toHaveTextContent('Recorrido SAS')
    expect(screen.getByTestId('invoice-issuer')).toHaveTextContent('CUIT 20000000001')
  })

  it('una factura autorizada por el simulador muestra siempre la leyenda de comprobante de prueba', async () => {
    current = authorized
    renderApp('/facturas/1')

    expect(await screen.findByTestId('simulated-legend')).toHaveTextContent(/sin validez fiscal/i)
  })

  it('con un proveedor real no aparece la leyenda', async () => {
    current = { ...authorized, simulated: false }
    renderApp('/facturas/1')

    await screen.findByRole('heading', { name: 'Registrar nuevo cobro' })
    expect(screen.queryByTestId('simulated-legend')).not.toBeInTheDocument()
  })

  it('un borrador no muestra emisor', async () => {
    renderApp('/facturas/1')

    await screen.findByRole('button', { name: 'Facturar' })
    expect(screen.queryByTestId('invoice-issuer')).not.toBeInTheDocument()
  })

  it('si se cancela la confirmación no llama a la API', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    mockAuthorize(authorized, {})
    const view = renderApp('/facturas/1')

    await view.user.click(await screen.findByRole('button', { name: 'Facturar' }))

    expect(posts).toBe(0)
    expect(screen.getByRole('button', { name: 'Facturar' })).toBeInTheDocument()
  })

  it('si ARCA rechaza muestra los motivos', async () => {
    mockAuthorize({ ...draft, status: 'REJECTED' }, {
      outcome: 'REJECTED',
      errors: [{ code: 10016, message: 'Número no consecutivo' }],
    })
    const view = renderApp('/facturas/1')

    await view.user.click(await screen.findByRole('button', { name: 'Facturar' }))

    expect(await screen.findByText(/ARCA rechazó la factura/)).toBeInTheDocument()
    expect(screen.getByText(/10016/)).toBeInTheDocument()
    expect(screen.getByText(/Número no consecutivo/)).toBeInTheDocument()
  })

  it('si ARCA no responde avisa que la factura quedó pendiente', async () => {
    mockAuthorize({ ...draft, status: 'PENDING' }, { outcome: 'INDETERMINATE' }, 202)
    const view = renderApp('/facturas/1')

    await view.user.click(await screen.findByRole('button', { name: 'Facturar' }))

    expect(await screen.findByText(/ARCA no respondió/)).toBeInTheDocument()
  })

  it('muestra el error del backend sin romper la pantalla', async () => {
    server.use(
      http.post(`${API_URL}/api/invoices/1/authorize`, () =>
        HttpResponse.json({ error: 'El proveedor fiscal no está disponible: falta ARCA_PROVIDER' }, { status: 503 }),
      ),
    )
    const view = renderApp('/facturas/1')

    await view.user.click(await screen.findByRole('button', { name: 'Facturar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El proveedor fiscal no está disponible')
    expect(screen.getByRole('button', { name: 'Facturar' })).toBeInTheDocument()
  })

  it('una factura pendiente no ofrece volver a facturar', async () => {
    current = { ...draft, status: 'PENDING' }
    renderApp('/facturas/1')

    expect(await screen.findByText(/Factura no disponible para cobro/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Facturar' })).not.toBeInTheDocument()
  })
})
