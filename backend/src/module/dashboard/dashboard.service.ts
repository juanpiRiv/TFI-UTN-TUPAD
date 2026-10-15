import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { DashboardSummaryQuery } from "./dashboard.schemas.js";

/**
 * Obtiene la organización de un usuario autenticado para determinar su moneda base.
 */
export async function getOrganizationByUserId(userId: number) {
  const org = await prisma.organization.findUnique({
    where: { userId },
    select: { id: true, baseCurrency: true },
  });

  if (!org) {
    throw new AppError(404, "Organization not found for this user");
  }

  return org;
}

/**
 * Calcula el resumen del dashboard (resultado de caja) para el período dado:
 * - Movimientos no anulados de la organización dentro del rango [from, to].
 * - Conversión a la moneda base si difiere de la base usando exchangeRate.
 * - Total de ingresos, egresos y resultado neto (income - expense).
 * - Total agrupado por categoría, ordenado de mayor a menor.
 */
export async function getDashboardSummary(
  userId: number,
  query: DashboardSummaryQuery,
) {
  const org = await getOrganizationByUserId(userId);

  const [transactions, invoices, payments] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        organizationId: org.id,
        voidedAt: null,
        transactionDate: {
          gte: new Date(`${query.from}T00:00:00.000Z`),
          lte: new Date(`${query.to}T00:00:00.000Z`),
        },
      },
      include: {
        category: {
          select: { id: true, name: true, type: true },
        },
      },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId: org.id,
        status: "AUTHORIZED",
        issueDate: {
          gte: new Date(`${query.from}T00:00:00.000Z`),
          lte: new Date(`${query.to}T00:00:00.000Z`),
        },
      },
      select: {
        totalAmount: true,
        currency: true,
        fiscalExchangeRate: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        invoice: {
          organizationId: org.id,
        },
        voidedAt: null,
        paymentDate: {
          gte: new Date(`${query.from}T00:00:00.000Z`),
          lte: new Date(`${query.to}T00:00:00.000Z`),
        },
      },
      select: {
        amount: true,
        currency: true,
        exchangeRate: true,
      },
    }),
  ]);

  let income = new Prisma.Decimal(0);
  let manualIncome = new Prisma.Decimal(0);
  let expense = new Prisma.Decimal(0);
  const categoryMap = new Map<
    number,
    { categoryId: number; name: string; type: string; total: Prisma.Decimal }
  >();

  for (const tx of transactions) {
    let converted: Prisma.Decimal;
    if (tx.currency === org.baseCurrency) {
      converted = tx.amount;
    } else {
      if (!tx.exchangeRate) {
        throw new AppError(
          500,
          `Transaction ${tx.id} in ${tx.currency} is missing exchangeRate`,
        );
      }
      converted = tx.amount
        .mul(tx.exchangeRate)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    }

    if (tx.type === "INCOME") {
      income = income.plus(converted);
      if (!tx.paymentId) {
        manualIncome = manualIncome.plus(converted);
      }
    } else if (tx.type === "EXPENSE") {
      expense = expense.plus(converted);
    }

    const existing = categoryMap.get(tx.categoryId);
    if (existing) {
      existing.total = existing.total.plus(converted);
    } else {
      categoryMap.set(tx.categoryId, {
        categoryId: tx.categoryId,
        name: tx.category?.name ?? "",
        type: tx.category?.type ?? tx.type,
        total: converted,
      });
    }
  }

  // Facturado en el período (facturas autorizadas en la moneda base)
  let invoiced = new Prisma.Decimal(0);
  for (const inv of invoices) {
    const converted =
      inv.currency === org.baseCurrency || !inv.fiscalExchangeRate
        ? inv.totalAmount
        : inv.totalAmount.mul(inv.fiscalExchangeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    invoiced = invoiced.plus(converted);
  }

  // Cobrado en el período (pagos no anulados en la moneda base)
  let collected = new Prisma.Decimal(0);
  for (const p of payments) {
    const converted =
      p.currency === org.baseCurrency || !p.exchangeRate
        ? p.amount
        : p.amount.mul(p.exchangeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    collected = collected.plus(converted);
  }

  const net = income.minus(expense);
  const difference = invoiced.minus(collected);
  const managementResult = invoiced.plus(manualIncome).minus(expense);

  const byCategory = [...categoryMap.values()]
    .sort((a, b) => b.total.comparedTo(a.total))
    .map((item) => ({
      categoryId: item.categoryId,
      name: item.name,
      type: item.type,
      total: item.total.toFixed(2),
    }));

  return {
    from: query.from,
    to: query.to,
    currency: org.baseCurrency,
    income: income.toFixed(2),
    expense: expense.toFixed(2),
    net: net.toFixed(2),
    transactionCount: transactions.length,
    invoiced: invoiced.toFixed(2),
    collected: collected.toFixed(2),
    difference: difference.toFixed(2),
    managementResult: managementResult.toFixed(2),
    byCategory,
  };
}
