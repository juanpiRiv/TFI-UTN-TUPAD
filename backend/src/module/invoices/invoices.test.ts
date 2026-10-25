import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { invoiceIdParamSchema } from "./invoices.schemas.js";
import { listInvoices, getInvoiceById } from "./invoices.service.js";

let prisma: any;
let dbAvailable = false;

if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
  try {
    const prismaModule = await import("../../lib/prisma.js");
    prisma = prismaModule.prisma;
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("⚠️ PostgreSQL no disponible para tests de integración de facturas");
  }
}

describe("invoices schemas", () => {
  it("valida invoiceIdParamSchema: rechaza IDs no numéricos o fuera de rango", () => {
    expect(invoiceIdParamSchema.safeParse({ invoiceId: "abc" }).success).toBe(false);
    expect(invoiceIdParamSchema.safeParse({ invoiceId: "0" }).success).toBe(false);
    expect(invoiceIdParamSchema.safeParse({ invoiceId: "-5" }).success).toBe(false);
    expect(invoiceIdParamSchema.safeParse({ invoiceId: "999999999999" }).success).toBe(false);

    const valid = invoiceIdParamSchema.safeParse({ invoiceId: "42" });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.invoiceId).toBe(42);
    }
  });
});

describe.skipIf(!dbAvailable)("invoices module integration tests", () => {
  let testUserId: number;
  let testOrgId: number;
  let testInvoiceId: number;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-invoices-${Date.now()}@test.com`,
        passwordHash: "hash123",
      },
    });
    testUserId = user.id;

    const org = await prisma.organization.create({
      data: {
        userId: user.id,
        cuit: `20${String(Date.now()).slice(-8)}`,
        legalName: "Invoices Test Org",
        taxCondition: "MONOTRIBUTO",
        baseCurrency: "ARS",
      },
    });
    testOrgId = org.id;

    const pos = await prisma.pointOfSale.create({
      data: {
        organizationId: org.id,
        number: 1,
        billingMethod: "CAE",
      },
    });

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        pointOfSaleId: pos.id,
        voucherType: "FACTURA_C",
        voucherNumber: 101,
        concept: "SERVICIOS",
        issueDate: new Date("2026-10-01"),
        currency: "ARS",
        totalAmount: 50000.0,
        status: "AUTHORIZED",
        // Fuera de borrador la base exige los datos del emisor (#95)
        issuerCuit: "20000000001",
        issuerLegalName: "Emisor de prueba",
        issuerTaxCondition: "MONOTRIBUTO",
        cae: "74000000000001",
        items: {
          create: [
            {
              description: "Consultoría de arquitectura",
              quantity: 1,
              unitPrice: 50000.0,
              subtotal: 50000.0,
            },
          ],
        },
      },
    });
    testInvoiceId = invoice.id;
  });

  it("lista las facturas de la organización con sus saldos y estados comerciales", async () => {
    const list = await listInvoices(testUserId);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(testInvoiceId);
    expect(list[0]?.totalAmount).toBe("50000.00");
    expect(list[0]?.totalPaid).toBe("0.00");
    expect(list[0]?.pendingBalance).toBe("50000.00");
    expect(list[0]?.commercialStatus).toBe("PENDING");
  });

  it("obtiene el detalle de una factura específica con items y pagos", async () => {
    const detail = await getInvoiceById(testUserId, testInvoiceId);
    expect(detail.invoiceId).toBe(testInvoiceId);
    expect(detail.totalAmount).toBe("50000.00");
    expect(detail.status).toBe("AUTHORIZED");
    expect(detail.commercialStatus).toBe("PENDING");
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]?.description).toBe("Consultoría de arquitectura");
    expect(detail.payments).toEqual([]);
  });

  it("arroja 404 si la factura no existe o pertenece a otra organización", async () => {
    await expect(getInvoiceById(testUserId, 999999)).rejects.toThrow(/Factura no encontrada/i);
  });
});
