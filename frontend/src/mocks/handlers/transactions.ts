import { http, HttpResponse } from 'msw'
import type { Transaction } from '@/features/transactions/schemas'
import type { Currency } from '@/lib/format'
import { isDecimal, isPositiveDecimal } from '@/lib/schema-helpers'
import { API_URL } from '@/lib/api'
import { db, nextId, nowIso, saveDb } from '../db'
import { formatRate } from '../money'
import { invalidData, resolveOrganization, type FieldDetail } from './context'

type TransactionBody = {
  type?: string
  amount?: string
  currency?: string
  exchangeRate?: string | null
  categoryId?: number
  clientId?: number | null
  transactionDate?: string
  description?: string | null
}

/** Stored shape: without the nested category and client, which are joined on read. */
export type StoredTransaction = Omit<Transaction, 'category' | 'client'>

function withRelations(tx: StoredTransaction): Transaction {
  const category = db.categories.find((candidate) => candidate.id === tx.categoryId)
  const client = db.clients.find((candidate) => candidate.id === tx.clientId)
  return {
    ...tx,
    category: { id: tx.categoryId, name: category?.name ?? '', type: category?.type ?? tx.type },
    client: client ? { id: client.id, name: client.name } : null,
  }
}

export const transactionHandlers = [
  http.get(`${API_URL}/api/transactions`, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const params = new URL(request.url).searchParams
    const from = params.get('from')
    const to = params.get('to')
    const type = params.get('type')
    const categoryId = Number(params.get('categoryId')) || null
    const clientId = Number(params.get('clientId')) || null

    const transactions = db.transactions
      .filter((tx) => tx.organizationId === organization.id && !tx.voidedAt)
      .filter((tx) => !from || tx.transactionDate >= from)
      .filter((tx) => !to || tx.transactionDate <= to)
      .filter((tx) => !type || tx.type === type)
      .filter((tx) => !categoryId || tx.categoryId === categoryId)
      .filter((tx) => !clientId || tx.clientId === clientId)
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.id - a.id)
      .map(withRelations)
    return HttpResponse.json(transactions)
  }),

  http.post(`${API_URL}/api/transactions`, async ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const body = (await request.json()) as TransactionBody
    const details: FieldDetail[] = []

    if (body.type !== 'INCOME' && body.type !== 'EXPENSE') {
      details.push({ field: 'type', message: 'Invalid type' })
    }
    if (!body.amount || !isDecimal(body.amount, 2) || !isPositiveDecimal(body.amount)) {
      details.push({ field: 'amount', message: 'Amount must be greater than zero' })
    }
    if (body.currency !== 'ARS' && body.currency !== 'USD') {
      details.push({ field: 'currency', message: 'Currency is required' })
    }
    const needsRate = body.currency !== organization.baseCurrency
    if (
      needsRate &&
      (!body.exchangeRate ||
        !isDecimal(body.exchangeRate, 6) ||
        !isPositiveDecimal(body.exchangeRate))
    ) {
      details.push({
        field: 'exchangeRate',
        message: 'Exchange rate is required for this currency',
      })
    }
    const category = db.categories.find(
      (candidate) =>
        candidate.id === body.categoryId && candidate.organizationId === organization.id,
    )
    if (!category || !category.isActive) {
      details.push({ field: 'categoryId', message: 'Category not found' })
    } else if (category.type !== body.type) {
      details.push({
        field: 'categoryId',
        message: 'Category type must match the transaction type',
      })
    }
    if (
      body.clientId != null &&
      !db.clients.some(
        (client) => client.id === body.clientId && client.organizationId === organization.id,
      )
    ) {
      details.push({ field: 'clientId', message: 'Client not found' })
    }
    if (!body.transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.transactionDate)) {
      details.push({ field: 'transactionDate', message: 'Invalid date' })
    }
    if (details.length) return invalidData(details)

    const now = nowIso()
    const transaction: StoredTransaction = {
      id: nextId(),
      organizationId: organization.id,
      paymentId: null,
      categoryId: body.categoryId as number,
      clientId: body.clientId ?? null,
      type: body.type as Transaction['type'],
      amount: body.amount as string,
      currency: body.currency as Currency,
      exchangeRate: needsRate && body.exchangeRate ? formatRate(body.exchangeRate) : null,
      transactionDate: body.transactionDate as string,
      description: body.description ?? null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    db.transactions.push(transaction)
    saveDb()
    return HttpResponse.json(withRelations(transaction), { status: 201 })
  }),
]
