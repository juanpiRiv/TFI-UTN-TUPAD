import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { Prisma } from "../../generated/prisma/client.js";
import { getUsdExchangeRate } from "../exchange-rates/exchange-rates.service.js";
import { getOrganizationByUserId } from "../transactions/transactions.service.js";
import type { CreatePaymentInput } from "./payments.schemas.js";

/**
 * Registra un pago contra una factura de forma atómica.
 * Reglas de negocio y consistencia (F1-5, F6-7, RN-03, RN-04, RN-05, RN-10, RNF-07):
 * 1. Bloqueo pesimista de la factura mediante SELECT ... FOR UPDATE dentro de prisma.$transaction.
 * 2. Validación de estado fiscal: solo facturas AUTHORIZED admiten cobro.
 * 3. Comparación estricta de importes como Decimales (Prisma.Decimal), jamás números flotantes de JS.
 * 4. La suma de pagos no anulados más el nuevo pago no puede exceder el totalAmount de la factura.
 * 5. Crea exactamente un Payment y un Transaction de tipo INCOME asociado (1:1 vía @unique payment_id).
 *    (O adopta un Transaction manual preexistente si se especifica adoptTransactionId, #98).
 * 6. Registra el AuditLog de la operación dentro de la misma transacción.
 */
export async function registerPayment(
  userId: number,
  invoiceId: number,
  data: CreatePaymentInput,
) {
  const org = await getOrganizationByUserId(userId);
  const amountDecimal = new Prisma.Decimal(data.amount);

  if (amountDecimal.lte(0)) {
    throw new AppError(400, "El importe debe ser mayor a cero");
  }

  // RN-05: Tipo de cambio si la moneda difiere de la moneda base
  const needsExchangeRate = data.currency !== org.baseCurrency;
  let resolvedExchangeRate: Prisma.Decimal | null = null;

  if (needsExchangeRate) {
    if (data.exchangeRate) {
      resolvedExchangeRate = new Prisma.Decimal(data.exchangeRate);
    } else if (data.currency === "USD" && org.baseCurrency === "ARS") {
      try {
        const rateDto = await getUsdExchangeRate(data.paymentDate);
        resolvedExchangeRate = new Prisma.Decimal(rateDto.value);
      } catch {
        throw new AppError(400, "Exchange rate is required for this currency");
      }
    } else {
      throw new AppError(400, "Exchange rate is required for this currency");
    }
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Bloqueo pesimista: Otro pago simultáneo sobre la misma factura espera aquí hasta el commit
    const invoices = await tx.$queryRaw<
      Array<{
        id: number;
        organization_id: number;
        total_amount: Prisma.Decimal;
        status: string;
        client_id: number | null;
        currency: string;
        voucher_number: number | null;
        voucher_type: string;
      }>
    >`
      SELECT id, organization_id, total_amount, status, client_id, currency, voucher_number, voucher_type
      FROM invoices
      WHERE id = ${invoiceId} AND organization_id = ${org.id}
      FOR UPDATE
    `;

    if (!invoices || invoices.length === 0) {
      throw new AppError(404, "Factura no encontrada");
    }

    const invoice = invoices[0]!;

    if (invoice.status !== "AUTHORIZED") {
      throw new AppError(422, "Solo se pueden registrar pagos sobre facturas autorizadas");
    }

    // 2. Sumamos lo ya cobrado con pagos no anulados (con la fila bloqueada)
    const paidAggregate = await tx.payment.aggregate({
      where: { invoiceId, voidedAt: null },
      _sum: { amount: true },
    });

    const paidSoFar = paidAggregate._sum.amount
      ? new Prisma.Decimal(paidAggregate._sum.amount)
      : new Prisma.Decimal("0.00");

    const totalAmount = new Prisma.Decimal(invoice.total_amount);
    const currentPending = totalAmount.minus(paidSoFar);

    // Comparación estricta con Prisma.Decimal (.greaterThan)
    if (paidSoFar.plus(amountDecimal).greaterThan(totalAmount)) {
      throw new AppError(422, "El pago supera el saldo pendiente de la factura", [
        {
          field: "amount",
          message: `El saldo pendiente es ${currentPending.toFixed(2)}`,
        },
      ]);
    }

    const newPendingBalance = currentPending.minus(amountDecimal);
    const commercialStatus = newPendingBalance.equals(0) ? "PAID" : "PARTIALLY_PAID";

    // 3. Garantizar que exista la categoría oficial "Cobro de facturas"
    let cobroCategory = await tx.category.findFirst({
      where: {
        organizationId: org.id,
        name: "Cobro de facturas",
        type: "INCOME",
      },
    });

    if (!cobroCategory) {
      cobroCategory = await tx.category.create({
        data: {
          organizationId: org.id,
          name: "Cobro de facturas",
          type: "INCOME",
          isActive: true,
        },
      });
    }

    // 4. Crear Payment
    const payment = await tx.payment.create({
      data: {
        invoiceId,
        amount: amountDecimal,
        currency: data.currency,
        exchangeRate: resolvedExchangeRate,
        paymentDate: new Date(data.paymentDate),
      },
    });

    // 5. Crear o adoptar el movimiento de ingreso (Transaction)
    let transaction;
    if (data.adoptTransactionId) {
      const adoptTx = await tx.transaction.findFirst({
        where: {
          id: data.adoptTransactionId,
          organizationId: org.id,
          voidedAt: null,
        },
      });

      if (!adoptTx) {
        throw new AppError(404, "Movimiento manual a adoptar no encontrado");
      }
      if (adoptTx.paymentId !== null) {
        throw new AppError(422, "El movimiento ya se encuentra vinculado a otro pago");
      }
      if (adoptTx.type !== "INCOME") {
        throw new AppError(422, "Solo se pueden adoptar movimientos de tipo ingreso");
      }
      if (!adoptTx.amount.equals(amountDecimal)) {
        throw new AppError(422, "El importe del movimiento a adoptar no coincide con el importe del pago");
      }
      if (adoptTx.currency !== data.currency) {
        throw new AppError(422, "La moneda del movimiento a adoptar no coincide con la moneda del pago");
      }

      transaction = await tx.transaction.update({
        where: { id: adoptTx.id },
        data: {
          paymentId: payment.id,
          categoryId: cobroCategory.id,
          clientId: invoice.client_id ?? adoptTx.clientId,
        },
      });
    } else {
      const voucherText = invoice.voucher_number
        ? `${invoice.voucher_type} #${invoice.voucher_number}`
        : `Factura #${invoice.id}`;
      const desc = data.description || `Cobro de ${voucherText}`;

      transaction = await tx.transaction.create({
        data: {
          organizationId: org.id,
          paymentId: payment.id,
          categoryId: cobroCategory.id,
          type: "INCOME",
          amount: amountDecimal,
          currency: data.currency,
          exchangeRate: resolvedExchangeRate,
          transactionDate: new Date(data.paymentDate),
          description: desc,
          clientId: invoice.client_id,
        },
      });
    }

    // 6. Auditoría atómica en la misma transacción
    await tx.auditLog.create({
      data: {
        organizationId: org.id,
        userId,
        action: "payment.created",
        entity: "Payment",
        entityId: payment.id,
        metadata: {
          invoiceId,
          amount: amountDecimal.toString(),
          currency: data.currency,
          exchangeRate: resolvedExchangeRate ? resolvedExchangeRate.toString() : null,
          previousPaid: paidSoFar.toString(),
          newPendingBalance: newPendingBalance.toString(),
          commercialStatus,
          adoptedTransactionId: data.adoptTransactionId ?? null,
        },
      },
    });

    const dateStr =
      payment.paymentDate instanceof Date
        ? payment.paymentDate.toISOString().slice(0, 10)
        : String(payment.paymentDate).slice(0, 10);

    return {
      payment: {
        id: payment.id,
        invoiceId: payment.invoiceId,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        exchangeRate: payment.exchangeRate ? payment.exchangeRate.toString() : null,
        paymentDate: dateStr,
        voidedAt: null,
        createdAt: payment.createdAt.toISOString(),
      },
      transaction: {
        id: transaction.id,
        organizationId: transaction.organizationId,
        paymentId: transaction.paymentId,
        categoryId: transaction.categoryId,
        clientId: transaction.clientId,
        type: transaction.type,
        amount: transaction.amount.toFixed(2),
        currency: transaction.currency,
        exchangeRate: transaction.exchangeRate ? transaction.exchangeRate.toString() : null,
        transactionDate: dateStr,
        description: transaction.description,
      },
      invoiceSummary: {
        invoiceId: invoice.id,
        totalAmount: totalAmount.toFixed(2),
        currency: invoice.currency,
        totalPaid: paidSoFar.plus(amountDecimal).toFixed(2),
        pendingBalance: newPendingBalance.toFixed(2),
        commercialStatus,
      },
    };
  });
}

/**
 * Consulta los pagos y calcula el saldo pendiente y estado comercial de una factura.
 */
export async function getInvoicePayments(userId: number, invoiceId: number) {
  const org = await getOrganizationByUserId(userId);

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: org.id },
    select: {
      id: true,
      totalAmount: true,
      currency: true,
      status: true,
      voucherType: true,
      voucherNumber: true,
      issueDate: true,
      recipientName: true,
      concept: true,
      cae: true,
      client: {
        select: {
          id: true,
          name: true,
        },
      },
      payments: {
        where: { voidedAt: null },
        orderBy: { paymentDate: "asc" },
        include: {
          transaction: {
            select: {
              id: true,
              type: true,
              categoryId: true,
              description: true,
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    throw new AppError(404, "Factura no encontrada");
  }

  const totalAmount = new Prisma.Decimal(invoice.totalAmount);
  let totalPaid = new Prisma.Decimal("0.00");

  const formattedPayments = invoice.payments.map((p) => {
    totalPaid = totalPaid.plus(p.amount);
    const dateStr =
      p.paymentDate instanceof Date
        ? p.paymentDate.toISOString().slice(0, 10)
        : String(p.paymentDate).slice(0, 10);

    return {
      id: p.id,
      invoiceId: p.invoiceId,
      amount: p.amount.toFixed(2),
      currency: p.currency,
      exchangeRate: p.exchangeRate ? p.exchangeRate.toString() : null,
      paymentDate: dateStr,
      voidedAt: p.voidedAt ? p.voidedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      transaction: p.transaction,
    };
  });

  const pendingBalance = totalAmount.minus(totalPaid);
  const commercialStatus = totalPaid.equals(0)
    ? "PENDING"
    : pendingBalance.equals(0)
    ? "PAID"
    : "PARTIALLY_PAID";

  const issueDateStr =
    invoice.issueDate instanceof Date
      ? invoice.issueDate.toISOString().slice(0, 10)
      : String(invoice.issueDate).slice(0, 10);

  return {
    invoiceId: invoice.id,
    voucherType: invoice.voucherType,
    voucherNumber: invoice.voucherNumber,
    status: invoice.status,
    currency: invoice.currency,
    issueDate: issueDateStr,
    concept: invoice.concept,
    cae: invoice.cae,
    recipientName: invoice.recipientName ?? invoice.client?.name ?? "Consumidor Final",
    client: invoice.client,
    totalAmount: totalAmount.toFixed(2),
    totalPaid: totalPaid.toFixed(2),
    pendingBalance: pendingBalance.toFixed(2),
    commercialStatus,
    payments: formattedPayments,
  };
}

/**
 * Lista todas las facturas de la organización con su estado comercial y saldos calculados.
 */
export async function listInvoices(userId: number) {
  const org = await getOrganizationByUserId(userId);

  const invoices = await prisma.invoice.findMany({
    where: { organizationId: org.id },
    orderBy: { issueDate: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      payments: {
        where: { voidedAt: null },
        select: { amount: true },
      },
    },
  });

  return invoices.map((inv) => {
    const totalAmount = new Prisma.Decimal(inv.totalAmount);
    const totalPaid = inv.payments.reduce(
      (sum, p) => sum.plus(p.amount),
      new Prisma.Decimal("0.00"),
    );
    const pendingBalance = totalAmount.minus(totalPaid);
    const commercialStatus = totalPaid.equals(0)
      ? "PENDING"
      : pendingBalance.equals(0)
      ? "PAID"
      : "PARTIALLY_PAID";

    const issueDateStr =
      inv.issueDate instanceof Date
        ? inv.issueDate.toISOString().slice(0, 10)
        : String(inv.issueDate).slice(0, 10);

    return {
      id: inv.id,
      voucherType: inv.voucherType,
      voucherNumber: inv.voucherNumber,
      concept: inv.concept,
      issueDate: issueDateStr,
      recipientName: inv.recipientName ?? inv.client?.name ?? "Consumidor Final",
      currency: inv.currency,
      totalAmount: totalAmount.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      pendingBalance: pendingBalance.toFixed(2),
      status: inv.status,
      commercialStatus,
      cae: inv.cae,
      client: inv.client,
    };
  });
}
