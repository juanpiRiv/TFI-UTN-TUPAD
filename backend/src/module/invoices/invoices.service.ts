import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { Prisma } from "../../generated/prisma/client.js";
import { getOrganizationByUserId } from "../transactions/transactions.service.js";
import type { CreateInvoiceInput } from "./invoices.schemas.js";

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

/**
 * Consulta el detalle de una factura por su ID, incluyendo cliente, pagos y saldos.
 */
export async function getInvoiceById(userId: number, invoiceId: number) {
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
      items: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          subtotal: true,
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
    items: invoice.items.map((it) => ({
      id: it.id,
      description: it.description,
      quantity: it.quantity.toString(),
      unitPrice: it.unitPrice.toFixed(2),
      subtotal: it.subtotal.toFixed(2),
    })),
    payments: formattedPayments,
  };
}

/**
 * Crea una factura en borrador (DRAFT) con sus ítems.
 * El backend calcula subtotales y total (docs/04, regla 9) y copia los datos del cliente
 * dentro de la factura (regla 8). Todavía no se manda a ARCA ni se asigna número.
 */
export async function createInvoice(userId: number, input: CreateInvoiceInput) {
  const org = await getOrganizationByUserId(userId);

  const pointOfSale = await prisma.pointOfSale.findFirst({
    where: input.pointOfSaleId
      ? { id: input.pointOfSaleId, organizationId: org.id }
      : { organizationId: org.id, isActive: true },
    orderBy: { number: "asc" },
  });
  if (!pointOfSale) {
    throw new AppError(404, "Punto de venta no encontrado");
  }

  const client = input.clientId
    ? await prisma.client.findFirst({ where: { id: input.clientId, organizationId: org.id } })
    : null;
  if (input.clientId && !client) {
    throw new AppError(404, "Cliente no encontrado");
  }
  if (client && !client.isActive) {
    throw new AppError(409, "El cliente está dado de baja");
  }

  const items = input.items.map((item) => {
    const quantity = new Prisma.Decimal(String(item.quantity));
    const unitPrice = new Prisma.Decimal(String(item.unitPrice));
    const subtotal = quantity.times(unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return {
      description: item.description,
      quantity: quantity.toFixed(3),
      unitPrice: unitPrice.toFixed(2),
      subtotal: subtotal.toFixed(2),
    };
  });
  const total = items.reduce((sum, item) => sum.plus(item.subtotal), new Prisma.Decimal(0));
  if (total.lessThanOrEqualTo(0)) {
    throw new AppError(400, "El total de la factura debe ser mayor a cero");
  }

  const toDate = (value?: string) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        organizationId: org.id,
        pointOfSaleId: pointOfSale.id,
        clientId: client?.id ?? null,
        voucherType: input.voucherType,
        concept: input.concept,
        issueDate: toDate(input.issueDate)!,
        recipientName: client?.name ?? "Consumidor Final",
        recipientDocType: client?.docType ?? "SIN_IDENTIFICAR",
        recipientDocNumber: client ? client.docNumber : "0",
        recipientAddress: client?.address ?? null,
        recipientTaxCondition: client?.taxCondition ?? "CONSUMIDOR_FINAL",
        currency: input.currency,
        fiscalExchangeRate: "1",
        serviceFrom: toDate(input.serviceFrom),
        serviceTo: toDate(input.serviceTo),
        paymentDueDate: toDate(input.paymentDueDate),
        totalAmount: total.toFixed(2),
        status: "DRAFT",
        items: { create: items },
      },
      include: { items: true },
    });

    await tx.auditLog.create({
      data: {
        organizationId: org.id,
        userId,
        action: "invoice.created",
        entity: "Invoice",
        entityId: invoice.id,
        metadata: { totalAmount: total.toFixed(2), currency: input.currency, items: items.length },
      },
    });

    return invoice;
  });
}
