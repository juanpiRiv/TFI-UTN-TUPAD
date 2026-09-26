import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { API_URL } from '@/lib/api'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import type { DashboardSummary } from './schemas'

const plain = (value: string | null) => value?.replace(/\s/g, ' ')

describe('dashboard', () => {
  beforeEach(() => {
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)
  })

  it('shows the totals returned by the API, as they come', async () => {
    let requestedPeriod: string | null = null
    server.use(
      http.get(`${API_URL}/api/dashboard/summary`, ({ request }) => {
        requestedPeriod = new URL(request.url).search
        const summary: DashboardSummary = {
          from: '2026-09-01',
          to: '2026-09-30',
          currency: 'ARS',
          income: '100000.00',
          expense: '15000.50',
          net: '84999.50',
          transactionCount: 3,
          byCategory: [{ categoryId: 1, name: 'Ventas', type: 'INCOME', total: '100000.00' }],
        }
        return HttpResponse.json(summary)
      }),
    )
    renderApp('/?from=2026-09-01&to=2026-09-30')

    expect(plain((await screen.findByTestId('total-income')).textContent)).toBe('$ 100.000,00')
    expect(plain(screen.getByTestId('total-expense').textContent)).toBe('$ 15.000,50')
    expect(plain(screen.getByTestId('total-net').textContent)).toBe('$ 84.999,50')
    expect(requestedPeriod).toBe('?from=2026-09-01&to=2026-09-30')
  })

  it('shows an empty state when the period has no movements', async () => {
    renderApp('/?from=2026-09-01&to=2026-09-30')

    expect(await screen.findByText('No hay movimientos en este período')).toBeInTheDocument()
    expect(plain(screen.getByTestId('total-net').textContent)).toBe('$ 0,00')
  })
})
