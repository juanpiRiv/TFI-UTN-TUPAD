import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { Prisma } from "../../generated/prisma/client.js";
import { resolveExchangeRate } from "../exchange-rates/exchange-rates.service.js";
import { getOrganizationByUserId } from "../transactions/transactions.service.js";
import type { CreatePaymentInput } from "./payments.schemas.js";

/**
 * Registra un pago contra una factura de forma atómica.
 * Reglas de negocio y consistencia (F1-5, F6-7, RN-03, RN-04, RN-05, RN-10, RNF-07):
 * 1. Bloqueo pesimista de la factura mediante SELECT ... FOR UPDATE dentro de prisma.$transaction.
 * 2. Validación de estado fiscal: solo facturas AUTHORIZED admiten cobro.
 * 3. La moneda del pago debe coincidir estrictamente con la moneda de la factura (en P0 todas en ARS).
 * 4. La fecha de pago no puede ser futura ni anterior a la fecha de emisión de la factura.
 * 5. Comparación estricta de importes como Decimales (Prisma.Decimal), jamás números flotantes de JS.
 * 6. La suma de pagos no anulados más el nuevo pago no puede exceder el totalAmount de la factura.
 * 7. Crea exactamente un Payment y un Transaction de tipo INCOME asociado (1:1 vía @unique payment_id).
 *    (O adopta un Transaction manual preexistente con SELECT ... FOR UPDATE para evitar carreras, #98).
 * 8. Registra el AuditLog de la operación dentro de la misma transacción.
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

  // RN-05: Tipo de cambio si la moneda del movimiento difiere de la moneda base
  const resolvedRate = await resolveExchangeRate(
    data.currency,
    org.baseCurrency,
    data.paymentDate,
    data.exchangeRate,
  );
  const resolvedExchangeRate = resolvedRate ? resolvedRate.value : null;

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
        issue_date: Date;
      }>
    >`
      SELECT id, organization_id, total_amount, status, client_id, currency, voucher_number, voucher_type, issue_date
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

    // P0: Exigir que la moneda del pago sea idéntica a la moneda de la factura
    if (data.currency !== invoice.currency) {
      throw new AppError(
        422,
        `La moneda del pago (${data.currency}) debe coincidir con la moneda de la factura (${invoice.currency})`,
      );
    }

    // P1: Validar rango de fecha de pago (no futura, no anterior a la emisión de la factura)
    const todayStr = new Date().toISOString().slice(0, 10);
    if (data.paymentDate > todayStr) {
      throw new AppError(422, "La fecha de pago no puede ser futura");
    }

    const issueDateStr =
      invoice.issue_date instanceof Date
        ? invoice.issue_date.toISOString().slice(0, 10)
        : String(invoice.issue_date).slice(0, 10);

    if (data.paymentDate < issueDateStr) {
      throw new AppError(
        422,
        `La fecha de pago (${data.paymentDate}) no puede ser anterior a la fecha de emisión de la factura (${issueDateStr})`,
      );
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

    // 3. Garantizar que exista la categoría oficial "Cobro de facturas" de forma atómica (evita carreras P2002)
    const catRows = await tx.$queryRaw<Array<{ id: number }>>`
      INSERT INTO categories (organization_id, name, type, is_active, created_at, updated_at)
      VALUES (${org.id}, 'Cobro de facturas', 'INCOME'::"MovementType", true, NOW(), NOW())
      ON CONFLICT (organization_id, name, type) DO UPDATE SET is_active = true
      RETURNING id
    `;
    const cobroCategoryId = catRows[0]!.id;

    const paymentDateUtc = new Date(`${data.paymentDate}T00:00:00.000Z`);

    // 4. Crear Payment
    const payment = await tx.payment.create({
      data: {
        invoiceId,
        amount: amountDecimal,
        currency: data.currency,
        exchangeRate: resolvedExchangeRate,
        paymentDate: paymentDateUtc,
      },
    });

    // 5. Crear o adoptar el movimiento de ingreso (Transaction)
    let transaction;
    if (data.adoptTransactionId) {
      // P1: Bloqueo pesimista del movimiento para evitar que dos pagos concurrentes lo adopten a la vez
      const adoptTxs = await tx.$queryRaw<
        Array<{
          id: number;
          organization_id: number;
          payment_id: number | null;
          type: string;
          amount: Prisma.Decimal;
          currency: string;
          client_id: number | null;
        }>
      >`
        SELECT id, organization_id, payment_id, type, amount, currency, client_id
        FROM transactions
        WHERE id = ${data.adoptTransactionId} AND organization_id = ${org.id} AND voided_at IS NULL
        FOR UPDATE
      `;

      if (!adoptTxs || adoptTxs.length === 0) {
        throw new AppError(404, "Movimiento manual a adoptar no encontrado");
      }
      const adoptTx = adoptTxs[0]!;
      if (adoptTx.payment_id !== null) {
        throw new AppError(422, "El movimiento ya se encuentra vinculado a otro pago");
      }
      if (adoptTx.type !== "INCOME") {
        throw new AppError(422, "Solo se pueden adoptar movimientos de tipo ingreso");
      }
      const adoptAmount = new Prisma.Decimal(adoptTx.amount);
      if (!adoptAmount.equals(amountDecimal)) {
        throw new AppError(422, "El importe del movimiento a adoptar no coincide con el importe del pago");
      }
      if (adoptTx.currency !== data.currency) {
        throw new AppError(422, "La moneda del movimiento a adoptar no coincide con la moneda del pago");
      }

      const updateResult = await tx.transaction.updateMany({
        where: {
          id: adoptTx.id,
          organizationId: org.id,
          paymentId: null,
          voidedAt: null,
        },
        data: {
          paymentId: payment.id,
          categoryId: cobroCategoryId,
          clientId: invoice.client_id ?? adoptTx.client_id,
        },
      });

      if (updateResult.count === 0) {
        throw new AppError(422, "El movimiento ya se encuentra vinculado a otro pago");
      }

      transaction = await tx.transaction.findUniqueOrThrow({
        where: { id: adoptTx.id },
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
          categoryId: cobroCategoryId,
          type: "INCOME",
          amount: amountDecimal,
          currency: data.currency,
          exchangeRate: resolvedExchangeRate,
          transactionDate: paymentDateUtc,
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

  return {
    invoiceId: invoice.id,
    voucherType: invoice.voucherType,
    voucherNumber: invoice.voucherNumber,
    status: invoice.status,
    currency: invoice.currency,
    totalAmount: totalAmount.toFixed(2),
    totalPaid: totalPaid.toFixed(2),
    pendingBalance: pendingBalance.toFixed(2),
    commercialStatus,
    payments: formattedPayments,
  };
}
