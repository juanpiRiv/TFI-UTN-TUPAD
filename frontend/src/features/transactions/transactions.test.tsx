import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_URL } from '@/lib/api'
import { db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { createTransactionSchema, type TransactionFormValues } from './schemas'

async function openForm() {
  const view = renderApp('/movimientos')
  await view.user.click(await screen.findByRole('button', { name: 'Nuevo movimiento' }))
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo movimiento' })
  return { ...view, dialog: within(dialog) }
}

describe('new transaction form', () => {
  beforeEach(() => {
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)
  })

  it('rejects an amount of zero', async () => {
    const { user, dialog } = await openForm()

    await user.type(dialog.getByLabelText('Importe'), '0,00')
    await user.selectOptions(dialog.getByLabelText('Categoría'), 'Ventas')
    await user.click(dialog.getByRole('button', { name: 'Guardar movimiento' }))

    expect(await dialog.findByText('El importe tiene que ser mayor a cero')).toBeInTheDocument()
    expect(db.transactions).toHaveLength(0)
  })

  it('asks for the exchange rate when the movement is in USD', async () => {
    // No suggestion available: the user has to type it.
    server.use(
      http.get(`${API_URL}/api/exchange-rates/usd`, () =>
        HttpResponse.json({ error: 'BCRA unavailable' }, { status: 503 }),
      ),
    )
    const { user, dialog } = await openForm()
    expect(dialog.queryByLabelText('Tipo de cambio')).not.toBeInTheDocument()

    await user.type(dialog.getByLabelText('Importe'), '100')
    await user.selectOptions(dialog.getByLabelText('Moneda'), 'USD')
    await user.selectOptions(dialog.getByLabelText('Categoría'), 'Ventas')
    await user.click(dialog.getByRole('button', { name: 'Guardar movimiento' }))

    expect(await dialog.findByText('Ingresá el tipo de cambio')).toBeInTheDocument()
    expect(db.transactions).toHaveLength(0)
  })

  it('suggests the USD rate, lets the user edit it and saves a copy', async () => {
    const { user, dialog } = await openForm()

    await user.type(dialog.getByLabelText('Importe'), '100')
    await user.selectOptions(dialog.getByLabelText('Moneda'), 'USD')
    const rate = await dialog.findByLabelText('Tipo de cambio')
    await vi.waitFor(() => expect(rate).not.toHaveValue(''))
    expect(dialog.getByText(/Sugerido: BCRA/)).toBeInTheDocument()

    await user.clear(rate)
    await user.type(rate, '1400,50')
    await user.selectOptions(dialog.getByLabelText('Categoría'), 'Ventas')
    await user.click(dialog.getByRole('button', { name: 'Guardar movimiento' }))

    expect(await screen.findByRole('cell', { name: /US\$\s100,00/ })).toBeInTheDocument()
    expect(db.transactions[0]).toMatchObject({
      amount: '100',
      currency: 'USD',
      exchangeRate: '1400.500000',
    })
  })
})

describe('createTransactionSchema', () => {
  const user = { id: 1 }
  const base: TransactionFormValues = {
    type: 'EXPENSE',
    amount: '1500',
    currency: 'ARS',
    exchangeRate: '',
    categoryId: '',
    clientId: '',
    transactionDate: '2026-09-10',
    description: '',
  }

  it('requires a category of the same type as the movement', () => {
    const category = {
      id: 7,
      organizationId: user.id,
      name: 'Ventas',
      type: 'INCOME' as const,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    }
    const schema = createTransactionSchema({ categories: [category], baseCurrency: 'ARS' })
    const result = schema.safeParse({ ...base, categoryId: '7' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'La categoría tiene que ser del mismo tipo que el movimiento',
    )
  })
})
