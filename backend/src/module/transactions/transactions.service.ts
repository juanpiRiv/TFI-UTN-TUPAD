import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { Prisma } from "../../generated/prisma/client.js";
import { resolveExchangeRate } from "../exchange-rates/exchange-rates.service.js";
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
} from "./transactions.schemas.js";

/**
 * Obtiene la organización de un usuario autenticado para control multi-tenant y moneda base.
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
 * Da formato estándar a una transacción según el contrato de la API.
 */
function formatTransaction(tx: {
  id: number;
  organizationId: number;
  paymentId: number | null;
  categoryId: number;
  clientId: number | null;
  type: string;
  amount: Prisma.Decimal;
  currency: string;
  exchangeRate: Prisma.Decimal | null;
  transactionDate: Date;
  description: string | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category?: { id: number; name: string; type: string };
  client?: { id: number; name: string } | null;
}) {
  const dateStr =
    tx.transactionDate instanceof Date
      ? tx.transactionDate.toISOString().slice(0, 10)
      : String(tx.transactionDate).slice(0, 10);

  return {
    id: tx.id,
    organizationId: tx.organizationId,
    paymentId: tx.paymentId,
    categoryId: tx.categoryId,
    clientId: tx.clientId,
    type: tx.type,
    amount: tx.amount.toString(),
    currency: tx.currency,
    exchangeRate: tx.exchangeRate ? tx.exchangeRate.toString() : null,
    transactionDate: dateStr,
    description: tx.description,
    voidedAt: tx.voidedAt ? tx.voidedAt.toISOString() : null,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
    category: tx.category
      ? {
          id: tx.category.id,
          name: tx.category.name,
          type: tx.category.type,
        }
      : undefined,
    client: tx.client
      ? {
          id: tx.client.id,
          name: tx.client.name,
        }
      : null,
  };
}

/**
 * Registra un nuevo movimiento manual (ingreso o egreso).
 * Valida reglas de dominio RN-01 a RN-06:
 * - Pertenencia a organización (RN-01).
 * - Moneda obligatoria y tipo de cambio si difiere de la base (RN-04, RN-05).
 * - Categoría perteneciente a la organización, activa y del mismo tipo.
 * - Cliente perteneciente a la organización si se proporciona.
 */
export async function createTransaction(
  userId: number,
  data: CreateTransactionInput,
) {
  const org = await getOrganizationByUserId(userId);

  // 1. Validar categoría: activa y del mismo tipo que el movimiento (P2: antes de llamadas externas)
  const category = await prisma.category.findFirst({
    where: {
      id: data.categoryId,
      organizationId: org.id,
    },
  });

  if (!category || !category.isActive) {
    throw new AppError(400, "Category not found or inactive");
  }

  if (category.type !== data.type) {
    throw new AppError(400, "Category type must match transaction type");
  }

  // 2. Validar cliente: si se envía, debe pertenecer a la organización y estar activo
  if (data.clientId) {
    const client = await prisma.client.findFirst({
      where: {
        id: data.clientId,
        organizationId: org.id,
        isActive: true,
      },
    });

    if (!client) {
      throw new AppError(400, "Client not found or inactive");
    }
  }

  // 3. Resolver tipo de cambio (RN-05): delegar a resolveExchangeRate para validar límites, antigüedad y fallback
  const resolvedRate = await resolveExchangeRate(
    data.currency,
    org.baseCurrency,
    data.transactionDate,
    data.exchangeRate,
  );

  const created = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        organizationId: org.id,
        categoryId: data.categoryId,
        clientId: data.clientId ?? null,
        type: data.type,
        amount: new Prisma.Decimal(data.amount),
        currency: data.currency,
        exchangeRate: resolvedRate?.value ?? null,
        transactionDate: new Date(`${data.transactionDate}T00:00:00.000Z`),
        description: data.description ?? null,
      },
      include: {
        category: { select: { id: true, name: true, type: true } },
        client: { select: { id: true, name: true } },
      },
    });

    // RNF-08: Trazabilidad en AuditLog registrando si el tipo de cambio fue manual o del BCRA (P1)
    await tx.auditLog.create({
      data: {
        organizationId: org.id,
        userId,
        action: "transaction.created",
        entity: "Transaction",
        entityId: transaction.id,
        metadata: {
          type: transaction.type,
          amount: transaction.amount.toString(),
          currency: transaction.currency,
          exchangeRate: transaction.exchangeRate?.toString(),
          exchangeRateSource: resolvedRate?.source ?? null,
          observedAt: resolvedRate?.observedAt ?? null,
          rateType: resolvedRate?.rateType ?? null,
          categoryId: data.categoryId,
          clientId: data.clientId ?? null,
          transactionDate: data.transactionDate,
        },
      },
    });

    return transaction;
  });

  return formatTransaction(created);
}

/**
 * Lista los movimientos no anulados de la organización con filtros opcionales.
 */
export async function listTransactions(
  userId: number,
  query: ListTransactionsQuery,
) {
  const org = await getOrganizationByUserId(userId);

  const where: Prisma.TransactionWhereInput = {
    organizationId: org.id,
    voidedAt: null,
  };

  if (query.type) where.type = query.type;
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.clientId) where.clientId = query.clientId;

  if (query.from || query.to) {
    where.transactionDate = {};
    if (query.from) {
      where.transactionDate.gte = new Date(`${query.from}T00:00:00.000Z`);
    }
    if (query.to) {
      where.transactionDate.lte = new Date(`${query.to}T00:00:00.000Z`);
    }
  }

  const take = query.limit ?? 50;

  const transactions = await prisma.transaction.findMany({
    where,
    take,
    orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
    include: {
      category: { select: { id: true, name: true, type: true } },
      client: { select: { id: true, name: true } },
    },
  });

  return transactions.map(formatTransaction);
}
