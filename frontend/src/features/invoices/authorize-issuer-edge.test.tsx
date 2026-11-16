import { screen, within } from '@testing-library/react'
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

const AUTHORIZE = `${API_URL}/api/invoices/1/authorize`

beforeEach(() => {
  const user = seedUser()
  seedOrganization(user.id)
  loginAs(user.id)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  server.use(http.get(`${API_URL}/api/invoices/1`, () => HttpResponse.json(draft)))
})

afterEach(() => vi.restoreAllMocks())

const reply422 = (body: object) =>
  server.use(http.post(AUTHORIZE, () => HttpResponse.json(body, { status: 422 })))

async function authorize(view: ReturnType<typeof renderApp>) {
  await view.user.click(await screen.findByRole('button', { name: 'Facturar' }))
}

describe('Facturar: ISSUER_INCOMPLETE', () => {
  it("lists the server's own labels from missingFields", async () => {
    reply422({
      message: 'Faltan datos del emisor para facturar.',
      code: 'ISSUER_INCOMPLETE',
      missing: ['commercialAddress', 'grossIncomeNumber'],
      missingFields: [
        { field: 'commercialAddress', label: 'Domicilio comercial' },
        { field: 'grossIncomeNumber', label: 'Ingresos Brutos (número, Exento o Convenio)' },
      ],
    })
    const view = renderApp('/facturas/1')

    await authorize(view)

    const alert = within(await screen.findByRole('alert'))
    expect(alert.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Domicilio comercial',
      'Ingresos Brutos (número, Exento o Convenio)',
    ])
  })

  it('falls back to the field names (translated) when missingFields is absent', async () => {
    reply422({
      message: 'x',
      code: 'ISSUER_INCOMPLETE',
      missing: ['activityStartDate', 'legalName'],
    })
    const view = renderApp('/facturas/1')

    await authorize(view)

    const alert = within(await screen.findByRole('alert'))
    expect(alert.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Fecha de inicio de actividades',
      'Razón social',
    ])
  })

  it('shows an unknown field name as is', async () => {
    reply422({ message: 'x', code: 'ISSUER_INCOMPLETE', missing: ['campoNuevo'] })
    const view = renderApp('/facturas/1')

    await authorize(view)

    expect(within(await screen.findByRole('alert')).getByRole('listitem')).toHaveTextContent(
      'campoNuevo',
    )
  })

  it('without any list it still says data is missing and links to Mi negocio', async () => {
    reply422({ message: 'x', code: 'ISSUER_INCOMPLETE' })
    const view = renderApp('/facturas/1')

    await authorize(view)

    const alert = within(await screen.findByRole('alert'))
    expect(alert.getByText(/Faltan datos de tu negocio/)).toBeInTheDocument()
    expect(alert.queryByRole('listitem')).not.toBeInTheDocument()
    expect(
      alert.getByRole('link', { name: /Completar los datos en Mi negocio/ }),
    ).toBeInTheDocument()
  })

  it('renders the labels as text, never as markup', async () => {
    reply422({
      code: 'ISSUER_INCOMPLETE',
      missingFields: [{ field: 'cuit', label: '<script>window.__x = 1</script>CUIT' }],
    })
    const view = renderApp('/facturas/1')

    await authorize(view)

    const item = within(await screen.findByRole('alert')).getByRole('listitem')
    expect(item.textContent).toBe('<script>window.__x = 1</script>CUIT')
    expect(item.querySelector('script')).toBeNull()
  })

  it('the link goes to /organizacion and navigating there works', async () => {
    reply422({ code: 'ISSUER_INCOMPLETE', missing: ['commercialAddress'] })
    const view = renderApp('/facturas/1')
    await authorize(view)

    const link = await screen.findByRole('link', { name: /Completar los datos en Mi negocio/ })
    expect(link).toHaveAttribute('href', '/organizacion')
    await view.user.click(link)

    expect(await screen.findByRole('heading', { name: 'Mi negocio' })).toBeInTheDocument()
  })

  it('re-enables the button and a retry that succeeds clears the alert', async () => {
    reply422({ code: 'ISSUER_INCOMPLETE', missing: ['commercialAddress'] })
    const view = renderApp('/facturas/1')
    await authorize(view)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Facturar' })).toBeEnabled()

    server.use(
      http.post(AUTHORIZE, () =>
        HttpResponse.json({
          invoice: { ...draft, status: 'AUTHORIZED', cae: '74123456789012', voucherNumber: 1 },
          fiscal: { outcome: 'AUTHORIZED', simulated: true, observations: [], errors: [] },
        }),
      ),
    )
    await authorize(view)

    expect(await screen.findByText(/Factura autorizada/)).toBeInTheDocument()
    expect(screen.queryByText(/Faltan datos de tu negocio/)).not.toBeInTheDocument()
  })
})

describe('Facturar: any other failure is unchanged', () => {
  it.each([
    [422, { message: 'Otra regla de negocio.', code: 'OTHER' }, 'Otra regla de negocio.'],
    [422, { error: 'Cliente sin CUIT' }, 'Cliente sin CUIT'],
    [409, { error: 'Solo se puede facturar un borrador' }, 'Solo se puede facturar un borrador'],
    [
      502,
      { error: 'ARCA devolvió una respuesta inválida' },
      'ARCA devolvió una respuesta inválida',
    ],
    [503, { message: 'ARCA no está disponible' }, 'ARCA no está disponible'],
    [500, null, 'Error 500'],
  ])(
    'a %s shows its message in an alert, no issuer link, and re-enables the button',
    async (status, body, text) => {
      server.use(
        http.post(AUTHORIZE, () =>
          body ? HttpResponse.json(body, { status }) : new HttpResponse(null, { status }),
        ),
      )
      const view = renderApp('/facturas/1')

      await authorize(view)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(text)
      expect(screen.queryByText(/Faltan datos de tu negocio/)).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Completar los datos/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Facturar' })).toBeEnabled()
    },
  )

  it('a network error shows the connection message and re-enables the button', async () => {
    server.use(http.post(AUTHORIZE, () => HttpResponse.error()))
    const view = renderApp('/facturas/1')

    await authorize(view)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo conectar con el servidor',
    )
    expect(screen.getByRole('button', { name: 'Facturar' })).toBeEnabled()
  })

  it('a 401 sends the user to the login', async () => {
    server.use(
      http.post(AUTHORIZE, () => HttpResponse.json({ error: 'Token expirado' }, { status: 401 })),
    )
    const view = renderApp('/facturas/1')

    await authorize(view)

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })
})
