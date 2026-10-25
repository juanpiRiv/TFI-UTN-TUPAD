import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/error.js";
import { registerPayment, getInvoicePayments } from "./payments.service.js";
import { createPaymentSchema, invoiceIdParamSchema } from "./payments.schemas.js";

// Verificamos si PostgreSQL está disponible antes de ejecutar la suite de integración
let prisma: any;
let dbAvailable = false;

if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
  try {
    const prismaModule = await import("../../lib/prisma.js");
    prisma = prismaModule.prisma;
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("⚠️ PostgreSQL no está disponible en localhost:5433; salteando tests de integración de pagos.");
  }
} else {
  console.warn("⚠️ DATABASE_URL o JWT_SECRET no configurados; salteando tests de integración de pagos.");
}

describe("payments schemas", () => {
  it("valida schemas de pagos: rechaza IDs fuera de rango, fechas inexistentes, tipo de cambio en 0 e importes desmedidos (P1)", () => {
    // invoiceId gigante fuera de rango integer
    const idRes = invoiceIdParamSchema.safeParse({ invoiceId: "99999999999" });
    expect(idRes.success).toBe(false);

    // adoptTransactionId gigante
    const adoptRes = createPaymentSchema.safeParse({
      amount: "100.00",
      paymentDate: "2026-10-10",
      currency: "ARS",
      adoptTransactionId: 99999999999,
    });
    expect(adoptRes.success).toBe(false);

    // exchangeRate "0"
    const rateZero = createPaymentSchema.safeParse({
      amount: "100.00",
      paymentDate: "2026-10-10",
      currency: "USD",
      exchangeRate: "0",
    });
    expect(rateZero.success).toBe(false);

    // Fecha inexistente 2026-02-31
    const invalidDate = createPaymentSchema.safeParse({
      amount: "100.00",
      paymentDate: "2026-02-31",
      currency: "ARS",
    });
    expect(invalidDate.success).toBe(false);

    // Importe desmedido con más de 12 dígitos enteros
    const hugeAmount = createPaymentSchema.safeParse({
      amount: "999999999999999.00",
      paymentDate: "2026-10-10",
      currency: "ARS",
    });
    expect(hugeAmount.success).toBe(false);
  });
});

describe.skipIf(!dbAvailable)("payments module (Real PostgreSQL integration tests)", () => {
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
      const invoiceIds = invoices.map((i: any) => i.id);
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
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901234",
      },
    });

    const res = await registerPayment(testUserId, invoice.id, {
      amount: "400.00",
      paymentDate: "2026-10-10",
      currency: "ARS",
    });

    expect(res.payment.amount).toBe("400.00");
    expect(res.payment.currency).toBe("ARS");
    expect(res.payment.invoiceId).toBe(invoice.id);

    // Exactamente 1 Transaction generado
    expect(res.transaction.amount).toBe("400.00");
    expect(res.transaction.type).toBe("INCOME");
    expect(res.transaction.paymentId).toBe(res.payment.id);

    // Saldo pendiente actualizado en el resumen
    expect(res.invoiceSummary.totalPaid).toBe("400.00");
    expect(res.invoiceSummary.pendingBalance).toBe("600.00");
    expect(res.invoiceSummary.commercialStatus).toBe("PARTIALLY_PAID");

    // Verificar consulta de estado comercial vía getInvoicePayments
    const status = await getInvoicePayments(testUserId, invoice.id);
    expect(status.totalAmount).toBe("1000.00");
    expect(status.totalPaid).toBe("400.00");
    expect(status.pendingBalance).toBe("600.00");
    expect(status.commercialStatus).toBe("PARTIALLY_PAID");
    expect(status.payments).toHaveLength(1);
    expect(status.payments[0]?.transaction).toBeDefined();
  });

  it("registrar dos pagos parciales no duplica ingresos y deja el saldo en cero", async () => {
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
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901235",
      },
    });

    // Pago 1: $ 200,00
    await registerPayment(testUserId, invoice.id, {
      amount: "200.00",
      paymentDate: "2026-10-05",
      currency: "ARS",
    });

    // Pago 2: $ 300,00 (completa el total)
    const res2 = await registerPayment(testUserId, invoice.id, {
      amount: "300.00",
      paymentDate: "2026-10-12",
      currency: "ARS",
    });

    expect(res2.invoiceSummary.totalPaid).toBe("500.00");
    expect(res2.invoiceSummary.pendingBalance).toBe("0.00");
    expect(res2.invoiceSummary.commercialStatus).toBe("PAID");

    // Verificar en la DB que existan exactamente 2 payments y 2 transactions vinculados
    const dbPayments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(dbPayments).toHaveLength(2);

    const paymentIds = dbPayments.map((p: any) => p.id);
    const dbTransactions = await prisma.transaction.findMany({
      where: { paymentId: { in: paymentIds } },
    });
    expect(dbTransactions).toHaveLength(2);

    const status = await getInvoicePayments(testUserId, invoice.id);
    expect(status.commercialStatus).toBe("PAID");
    expect(status.pendingBalance).toBe("0.00");
  });

  it("rechaza pagos si superan el saldo pendiente de la factura (422)", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 1003,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("100.00"),
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901236",
      },
    });

    await expect(
      registerPayment(testUserId, invoice.id, {
        amount: "150.00", // Supera $ 100,00
        paymentDate: "2026-10-05",
        currency: "ARS",
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: "El pago supera el saldo pendiente de la factura",
    });
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
        totalAmount: new Prisma.Decimal("100.00"),
        status: "DRAFT", // NO AUTORIZADA
      },
    });

    await expect(
      registerPayment(testUserId, draftInvoice.id, {
        amount: "50.00",
        paymentDate: "2026-10-05",
        currency: "ARS",
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: "Solo se pueden registrar pagos sobre facturas autorizadas",
    });
  });

  it("dos pagos simultáneos que juntos superan el total: uno entra y el otro se rechaza (concurrencia real con FOR UPDATE)", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 1004,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("100.00"),
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901237",
      },
    });

    // Dos pagos concurrentes de $ 80,00 (juntos = $ 160,00 > $ 100,00)
    const results = await Promise.allSettled([
      registerPayment(testUserId, invoice.id, {
        amount: "80.00",
        paymentDate: "2026-10-10",
        currency: "ARS",
      }),
      registerPayment(testUserId, invoice.id, {
        amount: "80.00",
        paymentDate: "2026-10-10",
        currency: "ARS",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactamente 1 pago debe entrar y 1 debe ser rechazado
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(AppError);
    expect(rejectedError.statusCode).toBe(422);

    // El saldo final de la factura debe ser exactamente $ 20,00 (100 - 80)
    const finalStatus = await getInvoicePayments(testUserId, invoice.id);
    expect(finalStatus.totalPaid).toBe("80.00");
    expect(finalStatus.pendingBalance).toBe("20.00");
    expect(finalStatus.commercialStatus).toBe("PARTIALLY_PAID");
  });

  it("permite adoptar un movimiento manual existente (#98) sin crear un movimiento duplicado", async () => {
    // 1. Factura por $ 300,00
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
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
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

  it("rechaza pagos en moneda distinta a la moneda de la factura (422 - P0)", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 2001,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("1000.00"),
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901239",
      },
    });

    await expect(
      registerPayment(testUserId, invoice.id, {
        amount: "600.00",
        paymentDate: "2026-10-10",
        currency: "USD",
        exchangeRate: "1500.00",
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("debe coincidir con la moneda de la factura"),
    });
  });

  it("dos pagos simultáneos sobre facturas distintas no pueden adoptar el mismo movimiento (concurrencia FOR UPDATE - P1)", async () => {
    const invoiceA = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 2002,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("500.00"),
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901240",
      },
    });

    const invoiceB = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 2003,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("500.00"),
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901241",
      },
    });

    const manualTx = await prisma.transaction.create({
      data: {
        organizationId: testOrgId,
        type: "INCOME",
        amount: new Prisma.Decimal("500.00"),
        currency: "ARS",
        transactionDate: new Date("2026-10-08"),
        categoryId: cobroCategoryId,
        description: "Cobro a adoptar en carrera",
        clientId: testClientId,
      },
    });

    // Lanzar dos registerPayment en paralelo intentando adoptar el mismo movimiento
    const results = await Promise.allSettled([
      registerPayment(testUserId, invoiceA.id, {
        amount: "500.00",
        paymentDate: "2026-10-08",
        currency: "ARS",
        adoptTransactionId: manualTx.id,
      }),
      registerPayment(testUserId, invoiceB.id, {
        amount: "500.00",
        paymentDate: "2026-10-08",
        currency: "ARS",
        adoptTransactionId: manualTx.id,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactamente uno debe tener éxito y el otro debe ser rechazado con 422
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(AppError);
    expect(rejectedError.statusCode).toBe(422);
    expect(rejectedError.message).toContain("ya se encuentra vinculado");
  });

  it("rechaza pagos con fecha futura o anterior a la emisión de la factura (422 - P1)", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: testOrgId,
        pointOfSaleId: testPointOfSaleId,
        clientId: testClientId,
        voucherType: "FACTURA_C",
        voucherNumber: 2004,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-10"),
        totalAmount: new Prisma.Decimal("100.00"),
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901242",
      },
    });

    // Anterior a la emisión (factura emitida el 10/10, pago el 05/10)
    await expect(
      registerPayment(testUserId, invoice.id, {
        amount: "100.00",
        paymentDate: "2026-10-05",
        currency: "ARS",
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("anterior a la fecha de emisión"),
    });

    // Fecha futura
    await expect(
      registerPayment(testUserId, invoice.id, {
        amount: "100.00",
        paymentDate: "2099-01-01",
        currency: "ARS",
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("no puede ser futura"),
    });
  });

  it("dos pagos simultáneos cuando la categoría 'Cobro de facturas' no existe no fallan por P2002 (upsert atómico - P2)", async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-race-cat-${Date.now()}@test.com`,
        passwordHash: "hash123",
      },
    });
    const org = await prisma.organization.create({
      data: {
        userId: user.id,
        cuit: `27${String(Date.now()).slice(-8)}`,
        legalName: "Org Test Race Category",
        taxCondition: "MONOTRIBUTO",
        baseCurrency: "ARS",
      },
    });
    const pos = await prisma.pointOfSale.create({
      data: { organizationId: org.id, number: 1 },
    });
    const invoice1 = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        pointOfSaleId: pos.id,
        voucherType: "FACTURA_C",
        voucherNumber: 1,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("100.00"),
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901243",
      },
    });
    const invoice2 = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        pointOfSaleId: pos.id,
        voucherType: "FACTURA_C",
        voucherNumber: 2,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        totalAmount: new Prisma.Decimal("100.00"),
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "12345678901244",
      },
    });

    // Dos pagos simultáneos sobre dos facturas distintas de esta nueva org sin categoría
    const [p1, p2] = await Promise.all([
      registerPayment(user.id, invoice1.id, {
        amount: "50.00",
        paymentDate: "2026-10-10",
        currency: "ARS",
      }),
      registerPayment(user.id, invoice2.id, {
        amount: "50.00",
        paymentDate: "2026-10-10",
        currency: "ARS",
      }),
    ]);

    expect(p1.payment.id).toBeDefined();
    expect(p2.payment.id).toBeDefined();

    // Solo debe existir 1 categoría "Cobro de facturas" para esa org
    const cats = await prisma.category.findMany({
      where: { organizationId: org.id, name: "Cobro de facturas" },
    });
    expect(cats).toHaveLength(1);

    // Limpieza
    await prisma.transaction.deleteMany({ where: { organizationId: org.id } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: [invoice1.id, invoice2.id] } } });
    await prisma.invoice.deleteMany({ where: { id: { in: [invoice1.id, invoice2.id] } } });
    await prisma.pointOfSale.deleteMany({ where: { organizationId: org.id } });
    await prisma.category.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });
});
