import { fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_URL } from '@/lib/api'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import type { Client } from './schemas'

const mockClient: Client = {
  id: 1,
  organizationId: 1,
  name: 'Acme Corp',
  docType: 'CUIT',
  docNumber: '30712345671',
  taxCondition: 'RESPONSABLE_INSCRIPTO',
  address: 'Av. Corrientes 1234',
  email: 'contacto@acme.com',
  phone: '1122334455',
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

describe('client detail and history', () => {
  beforeEach(() => {
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)

    server.use(
      http.get(`${API_URL}/api/clients/:id`, () => {
        return HttpResponse.json(mockClient)
      }),
    )
  })

  it('muestra la información del cliente y sus movimientos asociados', async () => {
    server.use(
      http.get(`${API_URL}/api/transactions`, ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('clientId')).toBe('1')

        return HttpResponse.json([
          {
            id: 101,
            organizationId: 1,
            paymentId: null,
            categoryId: 1,
            clientId: 1,
            type: 'INCOME',
            amount: '75000.00',
            currency: 'ARS',
            exchangeRate: null,
            transactionDate: '2026-10-05',
            description: 'Servicio de consultoría',
            voidedAt: null,
            createdAt: '2026-10-05T12:00:00.000Z',
            updatedAt: '2026-10-05T12:00:00.000Z',
            category: { id: 1, name: 'Ventas', type: 'INCOME' },
            client: { id: 1, name: 'Acme Corp' },
          },
        ])
      }),
    )

    renderApp('/clientes/1')

    // Verifica que se renderice el nombre del cliente y sus datos
    expect(await screen.findByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument()
    expect(screen.getByText('CUIT 30712345671')).toBeInTheDocument()
    expect(screen.getByText('contacto@acme.com')).toBeInTheDocument()

    // Verifica que se muestre el movimiento asociado
    expect(await screen.findByText('Servicio de consultoría')).toBeInTheDocument()
    expect(screen.getByText('+ $ 75.000,00')).toBeInTheDocument()
  })

  it('permite filtrar el historial de movimientos por fecha', async () => {
    let requestedParams: URLSearchParams | null = null

    server.use(
      http.get(`${API_URL}/api/transactions`, ({ request }) => {
        const url = new URL(request.url)
        requestedParams = url.searchParams

        const from = url.searchParams.get('from')
        if (from === '2026-10-10') {
          return HttpResponse.json([])
        }

        return HttpResponse.json([
          {
            id: 101,
            organizationId: 1,
            paymentId: null,
            categoryId: 1,
            clientId: 1,
            type: 'INCOME',
            amount: '50000.00',
            currency: 'ARS',
            exchangeRate: null,
            transactionDate: '2026-10-05',
            description: 'Mantenimiento mensual',
            voidedAt: null,
            createdAt: '2026-10-05T10:00:00.000Z',
            updatedAt: '2026-10-05T10:00:00.000Z',
            category: { id: 1, name: 'Ventas', type: 'INCOME' },
            client: { id: 1, name: 'Acme Corp' },
          },
        ])
      }),
    )

    renderApp('/clientes/1')

    expect(await screen.findByText('Mantenimiento mensual')).toBeInTheDocument()

    const fromInput = screen.getByLabelText('Desde')
    fireEvent.change(fromInput, { target: { value: '2026-10-10' } })

    await vi.waitFor(() => {
      expect(requestedParams?.get('from')).toBe('2026-10-10')
      expect(
        screen.getByText('No hay movimientos en este rango de fechas'),
      ).toBeInTheDocument()
    })
  })

  it('muestra estado vacío cuando el cliente no tiene movimientos', async () => {
    server.use(
      http.get(`${API_URL}/api/transactions`, () => {
        return HttpResponse.json([])
      }),
    )

    renderApp('/clientes/1')

    expect(await screen.findByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument()
    expect(
      await screen.findByText('Todavía no hay movimientos asociados a este cliente'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver movimientos' })).toBeInTheDocument()
  })

  it('muestra mensaje de error inmediatamente para id de cliente alfanumérico (/clientes/abc)', async () => {
    let transactionCalled = false
    server.use(
      http.get(`${API_URL}/api/transactions`, () => {
        transactionCalled = true
        return HttpResponse.json([])
      }),
    )

    renderApp('/clientes/abc')

    expect(await screen.findByText('Cliente inválido')).toBeInTheDocument()
    expect(transactionCalled).toBe(false)
  })

  it('muestra mensaje de error inmediatamente para id menor o igual a cero (/clientes/0)', async () => {
    renderApp('/clientes/0')

    expect(await screen.findByText('Cliente inválido')).toBeInTheDocument()
  })
})
