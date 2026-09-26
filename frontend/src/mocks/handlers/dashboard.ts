import { http, HttpResponse } from 'msw'
import type { DashboardSummary } from '@/features/dashboard/schemas'
import { API_URL } from '@/lib/api'
import { db } from '../db'
import { centsToDecimal, convertCents, toCents } from '../money'
import { invalidData, resolveOrganization } from './context'

export const dashboardHandlers = [
  http.get(`${API_URL}/api/dashboard/summary`, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const params = new URL(request.url).searchParams
    const from = params.get('from') ?? ''
    const to = params.get('to') ?? ''
    const datePattern = /^\d{4}-\d{2}-\d{2}$/
    if (!datePattern.test(from) || !datePattern.test(to) || from > to) {
      return invalidData([{ field: 'from', message: 'Invalid period' }])
    }

    let income = 0n
    let expense = 0n
    const byCategory = new Map<number, bigint>()
    const transactions = db.transactions.filter(
      (tx) =>
        tx.organizationId === organization.id &&
        !tx.voidedAt &&
        tx.transactionDate >= from &&
        tx.transactionDate <= to,
    )

    for (const tx of transactions) {
      // Same rule as the backend: convert to the base currency with the rate stored in the movement.
      const cents =
        tx.currency === organization.baseCurrency || !tx.exchangeRate
          ? toCents(tx.amount)
          : convertCents(tx.amount, tx.exchangeRate)
      if (tx.type === 'INCOME') income += cents
      else expense += cents
      byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0n) + cents)
    }

    const summary: DashboardSummary = {
      from,
      to,
      currency: organization.baseCurrency,
      income: centsToDecimal(income),
      expense: centsToDecimal(expense),
      net: centsToDecimal(income - expense),
      transactionCount: transactions.length,
      byCategory: [...byCategory.entries()]
        .map(([categoryId, total]) => {
          const category = db.categories.find((candidate) => candidate.id === categoryId)
          return {
            categoryId,
            name: category?.name ?? '',
            type: category?.type ?? 'INCOME',
            total: centsToDecimal(total),
            cents: total,
          }
        })
        .sort((a, b) => (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : 0))
        .map(({ cents: _cents, ...item }) => item),
    }
    return HttpResponse.json(summary)
  }),
]
