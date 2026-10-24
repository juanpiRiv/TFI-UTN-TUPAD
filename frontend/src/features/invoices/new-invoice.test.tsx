import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { API_URL } from '@/lib/api'
import { todayIso } from '@/lib/format'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { itemSubtotal, invoiceTotal } from './schemas'

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

const createdInvoice = {
  invoiceId: 99,
  voucherType: 'FACTURA_C',
  voucherNumber: null,
  status: 'DRAFT',
  currency: 'ARS',
  issueDate: todayIso(),
  concept: 'PRODUCTOS',
  cae: null,
  recipientName: 'Estudio García',
  client: { id: 7, name: 'Estudio García' },
  totalAmount: '215.02',
  totalPaid: '0.00',
  pendingBalance: '215.02',
  commercialStatus: 'PENDING',
  items: [],
  payments: [],
}

describe('cálculo de importes de la factura', () => {
  it('redondea el subtotal a dos decimales con mitad hacia arriba, sin usar floats', () => {
    expect(itemSubtotal('1,5', '10,01')).toBe('15.02')
    expect(itemSubtotal('2', '100')).toBe('200.00')
    expect(itemSubtotal('0.333', '100')).toBe('33.30')
  })

  it('devuelve cero cuando falta la cantidad o el precio', () => {
    expect(itemSubtotal('', '10')).toBe('0.00')
    expect(itemSubtotal('abc', '10')).toBe('0.00')
  })

  it('suma los subtotales para el total', () => {
    expect(
      invoiceTotal([
        { description: 'A', quantity: '1,5', unitPrice: '10,01' },
        { description: 'B', quantity: '2', unitPrice: '100' },
      ]),
    ).toBe('215.02')
  })
})

describe('alta de factura en borrador (Issue #45)', () => {
  beforeEach(() => {
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)
    server.use(http.get(`${API_URL}/api/clients`, () => HttpResponse.json([client])))
  })

  it('el listado de facturas ofrece el acceso a "Nueva factura"', async () => {
    server.use(http.get(`${API_URL}/api/invoices`, () => HttpResponse.json([])))
    renderApp('/facturas')

    const link = await screen.findByRole('link', { name: 'Nueva factura' })
    expect(link).toHaveAttribute('href', '/facturas/nueva')
  })

  it('muestra el total estimado a medida que se cargan los ítems', async () => {
    const view = renderApp('/facturas/nueva')

    expect(await screen.findByRole('heading', { name: 'Nueva factura' })).toBeInTheDocument()
    expect(screen.getByTestId('invoice-total')).toHaveTextContent('$ 0,00')

    await view.user.type(screen.getByLabelText('Cantidad'), '2')
    await view.user.type(screen.getByLabelText('Precio unitario'), '100')

    expect(screen.getByTestId('invoice-total')).toHaveTextContent('$ 200,00')
  })

  it('envía el borrador con el cliente y los ítems, y abre la factura creada', async () => {
    let body: unknown = null
    server.use(
      http.post(`${API_URL}/api/invoices`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(createdInvoice, { status: 201 })
      }),
      http.get(`${API_URL}/api/invoices/99`, () => HttpResponse.json(createdInvoice)),
    )
    const view = renderApp('/facturas/nueva')

    await screen.findByRole('heading', { name: 'Nueva factura' })
    await view.user.selectOptions(await screen.findByLabelText('Cliente'), '7')
    await view.user.selectOptions(screen.getByLabelText('Concepto'), 'PRODUCTOS')
    await view.user.type(screen.getByLabelText('Descripción'), 'Consultoría')
    await view.user.type(screen.getByLabelText('Cantidad'), '1,5')
    await view.user.type(screen.getByLabelText('Precio unitario'), '10,01')
    await view.user.click(screen.getByRole('button', { name: 'Crear borrador' }))

    expect(body).toEqual({
      clientId: 7,
      concept: 'PRODUCTOS',
      issueDate: todayIso(),
      items: [{ description: 'Consultoría', quantity: '1.5', unitPrice: '10.01' }],
    })
    // Abre el detalle de la factura recién creada
    expect(await screen.findByText('Borrador')).toBeInTheDocument()
  })

  it('sin cliente factura como consumidor final y no manda clientId', async () => {
    let body: Record<string, unknown> = {}
    server.use(
      http.post(`${API_URL}/api/invoices`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(createdInvoice, { status: 201 })
      }),
      http.get(`${API_URL}/api/invoices/99`, () => HttpResponse.json(createdInvoice)),
    )
    const view = renderApp('/facturas/nueva')

    await screen.findByRole('heading', { name: 'Nueva factura' })
    await view.user.selectOptions(screen.getByLabelText('Concepto'), 'PRODUCTOS')
    await view.user.type(screen.getByLabelText('Descripción'), 'Venta')
    await view.user.type(screen.getByLabelText('Cantidad'), '1')
    await view.user.type(screen.getByLabelText('Precio unitario'), '500')
    await view.user.click(screen.getByRole('button', { name: 'Crear borrador' }))

    await screen.findByText('Borrador')
    expect(body).not.toHaveProperty('clientId')
  })

  it('con concepto de servicios propone el mes de la factura y pide las fechas', async () => {
    let body: Record<string, unknown> = {}
    server.use(
      http.post(`${API_URL}/api/invoices`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...createdInvoice, concept: 'SERVICIOS' }, { status: 201 })
      }),
      http.get(`${API_URL}/api/invoices/99`, () => HttpResponse.json(createdInvoice)),
    )
    const view = renderApp('/facturas/nueva')

    await screen.findByRole('heading', { name: 'Nueva factura' })
    await view.user.selectOptions(screen.getByLabelText('Concepto'), 'SERVICIOS')
    const from = screen.getByLabelText('Servicio desde') as HTMLInputElement
    const to = screen.getByLabelText('Servicio hasta') as HTMLInputElement
    expect(from.value.endsWith('-01')).toBe(true)
    expect(from.value.slice(0, 7)).toBe(todayIso().slice(0, 7))
    expect(to.value.slice(0, 7)).toBe(todayIso().slice(0, 7))
    expect(screen.getByLabelText('Vencimiento del pago')).toBeInTheDocument()

    await view.user.type(screen.getByLabelText('Descripción'), 'Consultoría mensual')
    await view.user.type(screen.getByLabelText('Cantidad'), '1')
    await view.user.type(screen.getByLabelText('Precio unitario'), '250000')
    await view.user.click(screen.getByRole('button', { name: 'Crear borrador' }))

    await screen.findByText('Borrador')
    expect(body).toMatchObject({ concept: 'SERVICIOS', serviceFrom: from.value, serviceTo: to.value })
    expect(body).toHaveProperty('paymentDueDate')
  })

  it('no deja guardar una factura sin ítem completo y no llama a la API', async () => {
    let called = false
    server.use(
      http.post(`${API_URL}/api/invoices`, () => {
        called = true
        return HttpResponse.json(createdInvoice, { status: 201 })
      }),
    )
    const view = renderApp('/facturas/nueva')

    await screen.findByRole('heading', { name: 'Nueva factura' })
    await view.user.selectOptions(screen.getByLabelText('Concepto'), 'PRODUCTOS')
    await view.user.click(screen.getByRole('button', { name: 'Crear borrador' }))

    expect(await screen.findByText('La descripción es obligatoria')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('permite agregar y quitar ítems, pero siempre queda al menos uno', async () => {
    const view = renderApp('/facturas/nueva')

    await screen.findByRole('heading', { name: 'Nueva factura' })
    expect(screen.getAllByLabelText('Descripción')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Quitar ítem/ })).not.toBeInTheDocument()

    await view.user.click(screen.getByRole('button', { name: 'Agregar ítem' }))
    expect(screen.getAllByLabelText('Descripción')).toHaveLength(2)

    await view.user.click(screen.getByRole('button', { name: 'Quitar ítem 1' }))
    expect(screen.getAllByLabelText('Descripción')).toHaveLength(1)
  })

  it('muestra el error del backend arriba del formulario', async () => {
    server.use(
      http.post(`${API_URL}/api/invoices`, () =>
        HttpResponse.json({ error: 'El cliente está dado de baja' }, { status: 409 }),
      ),
    )
    const view = renderApp('/facturas/nueva')

    await screen.findByRole('heading', { name: 'Nueva factura' })
    await view.user.selectOptions(screen.getByLabelText('Concepto'), 'PRODUCTOS')
    await view.user.type(screen.getByLabelText('Descripción'), 'Venta')
    await view.user.type(screen.getByLabelText('Cantidad'), '1')
    await view.user.type(screen.getByLabelText('Precio unitario'), '500')
    await view.user.click(screen.getByRole('button', { name: 'Crear borrador' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('El cliente está dado de baja')).toBeInTheDocument()
  })
})
