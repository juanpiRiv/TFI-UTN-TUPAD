import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

// Valores falsos: la base está mockeada, pero config/env.ts exige las variables al importar la app.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET ??= "test-secret-solo-para-tests-0000000";
});

const tx = vi.hoisted(() => ({
  invoice: { create: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    pointOfSale: { findFirst: vi.fn() },
    client: { findFirst: vi.fn() },
    $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
  },
}));

import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";

describe("POST /api/invoices (crear factura en borrador, Issue #45)", () => {
  const userId = 10;
  const orgId = 5;
  const token = jwt.sign({}, env.JWT_SECRET, { subject: String(userId) });

  const validBody = () => ({
    pointOfSaleId: 3,
    clientId: 7,
    concept: "PRODUCTOS",
    issueDate: "2026-10-24",
    items: [
      { description: "Consultoría", quantity: 1.5, unitPrice: 10.01 },
      { description: "Hosting", quantity: 2, unitPrice: 100 },
    ],
  });

  const post = (body: unknown) =>
    request(app).post("/api/invoices").set("Authorization", `Bearer ${token}`).send(body as object);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: orgId, baseCurrency: "ARS" } as never);
    vi.mocked(prisma.pointOfSale.findFirst).mockResolvedValue({ id: 3, organizationId: orgId } as never);
    vi.mocked(prisma.client.findFirst).mockResolvedValue({
      id: 7,
      organizationId: orgId,
      isActive: true,
      name: "Estudio García",
      docType: "CUIT",
      docNumber: "30712345678",
      address: "Calle 1",
      taxCondition: "RESPONSABLE_INSCRIPTO",
    } as never);
    tx.invoice.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 99,
      ...data,
      items: [],
    }));
  });

  it("devuelve 401 sin token", async () => {
    const res = await request(app).post("/api/invoices").send(validBody());
    expect(res.status).toBe(401);
  });

  it("crea la factura en borrador y calcula subtotales y total en el backend", async () => {
    const res = await post({ ...validBody(), totalAmount: "1.00" });

    expect(res.status).toBe(201);
    const data = tx.invoice.create.mock.calls[0]![0].data;
    expect(data.status).toBe("DRAFT");
    expect(data.organizationId).toBe(orgId);
    expect(data.voucherType).toBe("FACTURA_C");
    expect(data.currency).toBe("ARS");
    // 1.5 * 10.01 = 15.015 -> 15.02 (mitad hacia arriba); 2 * 100 = 200.00
    expect(data.items.create.map((i: { subtotal: string }) => i.subtotal)).toEqual(["15.02", "200.00"]);
    expect(data.totalAmount).toBe("215.02");
  });

  it("copia los datos del cliente dentro de la factura (RN snapshot del receptor)", async () => {
    await post(validBody());

    const data = tx.invoice.create.mock.calls[0]![0].data;
    expect(data.clientId).toBe(7);
    expect(data.recipientName).toBe("Estudio García");
    expect(data.recipientDocType).toBe("CUIT");
    expect(data.recipientDocNumber).toBe("30712345678");
    expect(data.recipientTaxCondition).toBe("RESPONSABLE_INSCRIPTO");
  });

  it("sin cliente emite como consumidor final", async () => {
    const { clientId: _ignored, ...body } = validBody();
    const res = await post(body);

    expect(res.status).toBe(201);
    const data = tx.invoice.create.mock.calls[0]![0].data;
    expect(data.clientId).toBeNull();
    expect(data.recipientDocType).toBe("SIN_IDENTIFICAR");
    expect(data.recipientDocNumber).toBe("0");
    expect(data.recipientTaxCondition).toBe("CONSUMIDOR_FINAL");
  });

  it("registra la creación en la auditoría dentro de la misma transacción", async () => {
    await post(validBody());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const audit = tx.auditLog.create.mock.calls[0]![0].data;
    expect(audit.action).toBe("invoice.created");
    expect(audit.entity).toBe("Invoice");
    expect(audit.entityId).toBe(99);
    expect(audit.userId).toBe(userId);
  });

  it("rechaza una factura sin ítems (RN-07)", async () => {
    const res = await post({ ...validBody(), items: [] });
    expect(res.status).toBe(400);
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  it("rechaza cantidad en cero, precio negativo y descripción vacía", async () => {
    for (const item of [
      { description: "A", quantity: 0, unitPrice: 10 },
      { description: "A", quantity: 1, unitPrice: -1 },
      { description: "  ", quantity: 1, unitPrice: 10 },
    ]) {
      const res = await post({ ...validBody(), items: [item] });
      expect(res.status).toBe(400);
    }
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  it("rechaza un total en cero", async () => {
    const res = await post({ ...validBody(), items: [{ description: "Gratis", quantity: 1, unitPrice: 0 }] });
    expect(res.status).toBe(400);
  });

  it("rechaza una moneda distinta de ARS en el P0 (regla 10 de docs/04)", async () => {
    const res = await post({ ...validBody(), currency: "USD" });
    expect(res.status).toBe(400);
  });

  it("exige las fechas del servicio si el concepto incluye servicios", async () => {
    const sinFechas = await post({ ...validBody(), concept: "SERVICIOS" });
    expect(sinFechas.status).toBe(400);

    const conFechas = await post({
      ...validBody(),
      concept: "SERVICIOS",
      serviceFrom: "2026-10-01",
      serviceTo: "2026-10-31",
      paymentDueDate: "2026-11-23",
    });
    expect(conFechas.status).toBe(201);
  });

  it("rechaza fechas con formato inválido", async () => {
    const res = await post({ ...validBody(), issueDate: "24/10/2026" });
    expect(res.status).toBe(400);
  });

  it("devuelve 404 si el cliente no existe o es de otra organización", async () => {
    vi.mocked(prisma.client.findFirst).mockResolvedValue(null);
    const res = await post(validBody());
    expect(res.status).toBe(404);
    expect(vi.mocked(prisma.client.findFirst).mock.calls[0]![0]?.where).toMatchObject({ organizationId: orgId });
  });

  it("devuelve 409 si el cliente está dado de baja", async () => {
    vi.mocked(prisma.client.findFirst).mockResolvedValue({ id: 7, isActive: false, name: "Baja" } as never);
    const res = await post(validBody());
    expect(res.status).toBe(409);
  });

  it("devuelve 404 si el punto de venta no es de la organización", async () => {
    vi.mocked(prisma.pointOfSale.findFirst).mockResolvedValue(null);
    const res = await post(validBody());
    expect(res.status).toBe(404);
    expect(vi.mocked(prisma.pointOfSale.findFirst).mock.calls[0]![0]?.where).toMatchObject({ organizationId: orgId });
  });

  it("sin pointOfSaleId usa el primer punto de venta activo de la organización", async () => {
    const { pointOfSaleId: _ignored, ...body } = validBody();
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(vi.mocked(prisma.pointOfSale.findFirst).mock.calls[0]![0]?.where).toMatchObject({
      organizationId: orgId,
      isActive: true,
    });
  });

  it("devuelve 403 si el usuario todavía no tiene organización", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
    const res = await post(validBody());
    expect(res.status).toBe(403);
  });
});
