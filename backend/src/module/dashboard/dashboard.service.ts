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

  const transactions = await prisma.transaction.findMany({
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
  });

  let income = new Prisma.Decimal(0);
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

  const net = income.minus(expense);

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
    byCategory,
  };
}
