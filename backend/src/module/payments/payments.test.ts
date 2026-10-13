import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/error.js";
import { registerPayment, getInvoicePayments } from "./payments.service.js";

describe("payments module (Real PostgreSQL integration tests)", () => {
  let testUserId: number;
  let testOrgId: number;
  let testPointOfSaleId: number;
  let testClientId: number;
  let cobroCategoryId: number;

  beforeAll(async () => {
    // 1. Crear usuario de prueba
    const user = await prisma.user.create({
      data: {
        email: `test-payments-${Date.now()}@test.com`,
        passwordHash: "hashedpassword123",
      },
    });
    testUserId = user.id;

    // 2. Crear organización de prueba con CUIT ficticio único
    const cuitSuffix = String(Date.now()).slice(-8);
    const org = await prisma.organization.create({
      data: {
        userId: user.id,
        cuit: `20${cuitSuffix}`,
        legalName: "Organización Test Pagos",
        taxCondition: "MONOTRIBUTO",
        baseCurrency: "ARS",
      },
    });
    testOrgId = org.id;

    // 3. Crear Punto de Venta
    const pos = await prisma.pointOfSale.create({
      data: {
        organizationId: org.id,
        number: 99,
      },
    });
    testPointOfSaleId = pos.id;

    // 4. Asegurar categoría "Cobro de facturas"
    const cat = await prisma.category.create({
      data: {
        organizationId: org.id,
        name: "Cobro de facturas",
        type: "INCOME",
        isActive: true,
      },
    });
    cobroCategoryId = cat.id;

    // 5. Crear cliente de prueba
    const client = await prisma.client.create({
      data: {
        organizationId: org.id,
        name: "Cliente Test Facturación",
        docType: "DNI",
        docNumber: `99${cuitSuffix.slice(-6)}`,
        taxCondition: "CONSUMIDOR_FINAL",
      },
    });
    testClientId = client.id;
  });

  afterAll(async () => {
    // Limpieza de datos creados en el test
    if (testOrgId) {
      await prisma.auditLog.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.transaction.deleteMany({ where: { organizationId: testOrgId } });
      const invoices = await prisma.invoice.findMany({
        where: { organizationId: testOrgId },
        select: { id: true },
      });
      const invoiceIds = invoices.map((i) => i.id);
      if (invoiceIds.length > 0) {
        await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      await prisma.category.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.client.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.pointOfSale.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.organization.deleteMany({ where: { id: testOrgId } });
    }
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
  });

  it("registrar un pago crea exactamente un Transaction de tipo ingreso y baja el saldo pendiente en la misma proporción", async () => {
    // Factura de $ 1.000,00 autorizada
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 1001,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("1000.00"),
        status: "AUTHORIZED",
        cae: "12345678901234",
      },
    });

    const res = await registerPayment(testUserId, invoice.id, {
      amount: "400.00",
      paymentDate: "2026-10-10",
      currency: "ARS",
    });

    // 1. Verificación de la respuesta
    expect(res.payment.amount).toBe("400.00");
    expect(res.transaction.type).toBe("INCOME");
    expect(res.transaction.amount).toBe("400.00");
    expect(res.transaction.categoryId).toBe(cobroCategoryId);
    expect(res.invoiceSummary.totalPaid).toBe("400.00");
    expect(res.invoiceSummary.pendingBalance).toBe("600.00");
    expect(res.invoiceSummary.commercialStatus).toBe("PARTIALLY_PAID");

    // 2. Verificación directa en base de datos PostgreSQL
    const paymentsInDb = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(paymentsInDb).toHaveLength(1);
    expect(paymentsInDb[0]?.amount.toFixed(2)).toBe("400.00");

    const transactionsInDb = await prisma.transaction.findMany({
      where: { paymentId: res.payment.id },
    });
    expect(transactionsInDb).toHaveLength(1);
    expect(transactionsInDb[0]?.type).toBe("INCOME");
    expect(transactionsInDb[0]?.amount.toFixed(2)).toBe("400.00");

    // 3. Auditoría registrada
    const auditLogs = await prisma.auditLog.findMany({
      where: { organizationId: testOrgId, entity: "Payment", entityId: res.payment.id },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe("payment.created");
  });

  it("registrar dos pagos parciales no duplica ingresos y deja el saldo en cero", async () => {
    // Factura de $ 500,00
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 1002,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("500.00"),
        status: "AUTHORIZED",
        cae: "12345678901235",
      },
    });

    // Primer pago parcial: $ 200,00
    const p1 = await registerPayment(testUserId, invoice.id, {
      amount: "200.00",
      paymentDate: "2026-10-05",
      currency: "ARS",
    });
    expect(p1.invoiceSummary.pendingBalance).toBe("300.00");
    expect(p1.invoiceSummary.commercialStatus).toBe("PARTIALLY_PAID");

    // Segundo pago parcial: $ 300,00
    const p2 = await registerPayment(testUserId, invoice.id, {
      amount: "300.00",
      paymentDate: "2026-10-12",
      currency: "ARS",
    });
    expect(p2.invoiceSummary.pendingBalance).toBe("0.00");
    expect(p2.invoiceSummary.commercialStatus).toBe("PAID");

    // Verificar que existen exactamente 2 pagos y exactamente 2 transacciones (sin duplicados)
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(2);

    const tx1 = await prisma.transaction.findUnique({ where: { paymentId: p1.payment.id } });
    const tx2 = await prisma.transaction.findUnique({ where: { paymentId: p2.payment.id } });
    expect(tx1).toBeDefined();
    expect(tx2).toBeDefined();
    expect(tx1?.id).not.toBe(tx2?.id);

    // Consulta de resumen
    const summary = await getInvoicePayments(testUserId, invoice.id);
    expect(summary.totalPaid).toBe("500.00");
    expect(summary.pendingBalance).toBe("0.00");
    expect(summary.commercialStatus).toBe("PAID");
    expect(summary.payments).toHaveLength(2);
  });

  it("rechaza pagos si superan el saldo pendiente de la factura (422)", async () => {
    // Factura de $ 200,00
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 1003,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("200.00"),
        status: "AUTHORIZED",
        cae: "12345678901236",
      },
    });

    // Intento de pago de $ 250,00
    await expect(
      registerPayment(testUserId, invoice.id, {
        amount: "250.00",
        paymentDate: "2026-10-05",
        currency: "ARS",
      }),
    ).rejects.toThrow(AppError);

    // Confirmar que no se guardó ningún pago ni movimiento
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(0);
  });

  it("rechaza pagos si la factura no está autorizada (ej. DRAFT) (422)", async () => {
    const draftInvoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: null,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("200.00"),
        status: "DRAFT",
      },
    });

    await expect(
      registerPayment(testUserId, draftInvoice.id, {
        amount: "100.00",
        paymentDate: "2026-10-05",
        currency: "ARS",
      }),
    ).rejects.toThrow("Solo se pueden registrar pagos sobre facturas autorizadas");
  });

  it("dos pagos simultáneos que juntos superan el total: uno entra y el otro se rechaza (concurrencia real con FOR UPDATE)", async () => {
    // Factura de $ 1.000,00 autorizada
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 1004,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("1000.00"),
        status: "AUTHORIZED",
        cae: "12345678901237",
      },
    });

    // Dos pagos de $ 600,00 disparados en paralelo.
    // 600 + 600 = 1200 > 1000.
    // Con SELECT ... FOR UPDATE, uno de los dos bloquea la fila primero.
    // El primero se inserta ($600). El segundo despierta, lee paid = $600, saldo = $400,
    // y debe ser rechazado con 422.
    const [result1, result2] = await Promise.allSettled([
      registerPayment(testUserId, invoice.id, {
        amount: "600.00",
        paymentDate: "2026-10-10",
        currency: "ARS",
      }),
      registerPayment(testUserId, invoice.id, {
        amount: "600.00",
        paymentDate: "2026-10-10",
        currency: "ARS",
      }),
    ]);

    const fulfilled = [result1, result2].filter((r) => r.status === "fulfilled");
    const rejected = [result1, result2].filter((r) => r.status === "rejected");

    // Exactamente uno aceptado y uno rechazado
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // El error del rechazado debe ser AppError 422
    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectionReason).toBeInstanceOf(AppError);
    expect(rejectionReason.statusCode).toBe(422);
    expect(rejectionReason.message).toBe("El pago supera el saldo pendiente de la factura");

    // En la base de datos PostgreSQL debe haber quedado exactamente 1 pago de $600
    const paymentsInDb = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(paymentsInDb).toHaveLength(1);
    expect(paymentsInDb[0]?.amount.toFixed(2)).toBe("600.00");

    // Y el saldo pendiente en la DB debe ser exactamente $400.00
    const summary = await getInvoicePayments(testUserId, invoice.id);
    expect(summary.totalPaid).toBe("600.00");
    expect(summary.pendingBalance).toBe("400.00");
    expect(summary.commercialStatus).toBe("PARTIALLY_PAID");
  });

  it("permite adoptar un movimiento manual existente (#98) sin crear un movimiento duplicado", async () => {
    // 1. Factura autorizada de $ 300,00
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 1005,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("300.00"),
        status: "AUTHORIZED",
        cae: "12345678901238",
      },
    });

    // 2. Movimiento manual previo cargado por el usuario sin factura asociada
    const manualTx = await prisma.transaction.create({
      data: {
        organizationId: testOrgId,
        type: "INCOME",
        amount: new Prisma.Decimal("300.00"),
        currency: "ARS",
        transactionDate: new Date("2026-10-08"),
        categoryId: cobroCategoryId,
        description: "Cobro por transferencia previa",
        clientId: testClientId,
      },
    });

    // 3. Registrar el pago adoptando el movimiento manual
    const res = await registerPayment(testUserId, invoice.id, {
      amount: "300.00",
      paymentDate: "2026-10-08",
      currency: "ARS",
      adoptTransactionId: manualTx.id,
    });

    // Debe haber vinculado el movimiento existente
    expect(res.transaction.id).toBe(manualTx.id);
    expect(res.transaction.paymentId).toBe(res.payment.id);

    // Verificar que en la DB el transaction adoptado ahora tiene payment_id
    const updatedTx = await prisma.transaction.findUnique({ where: { id: manualTx.id } });
    expect(updatedTx?.paymentId).toBe(res.payment.id);

    // Verificar que no se creó ninguna otra transacción
    const allTxsForPayment = await prisma.transaction.findMany({
      where: { paymentId: res.payment.id },
    });
    expect(allTxsForPayment).toHaveLength(1);
    expect(allTxsForPayment[0]?.id).toBe(manualTx.id);
  });
});
