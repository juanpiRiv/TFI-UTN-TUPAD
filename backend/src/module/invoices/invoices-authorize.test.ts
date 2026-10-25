import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET ??= "test-secret-solo-para-tests-0000000";
  process.env.ARCA_PROVIDER ??= "simulated";
});

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  invoice: { update: vi.fn(), aggregate: vi.fn() },
  auditLog: { create: vi.fn() },
}));
const current = vi.hoisted(() => ({ provider: null as unknown, factoryError: null as Error | null }));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    invoice: { findFirst: vi.fn() },
    $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
  },
}));
vi.mock("../arca/provider-factory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../arca/provider-factory.js")>()),
  createFiscalProvider: () => {
    if (current.factoryError) throw current.factoryError;
    return current.provider;
  },
}));

import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { ArcaSimulatedClient, type SimulatedScenario } from "../arca/simulated/arca-simulated-client.js";
import type { FiscalProvider } from "../arca/fiscal-provider.js";

describe("POST /api/invoices/:id/authorize (botón Facturar, Issue #59)", () => {
  const userId = 10;
  const orgId = 5;
  const token = jwt.sign({}, env.JWT_SECRET, { subject: String(userId) });

  const org = {
    id: orgId,
    cuit: "20000000001",
    legalName: "Recorrido SAS",
    tradeName: "Recorrido",
    commercialAddress: "Av. Siempre Viva 742",
    taxCondition: "MONOTRIBUTO",
    grossIncomeNumber: "901-123456-7",
    activityStartDate: new Date("2020-03-01T00:00:00.000Z"),
  };

  /** Estado que simula la fila de la factura en la base. */
  let row: Record<string, unknown>;

  const draftRow = () => ({
    id: 99,
    organizationId: orgId,
    pointOfSaleId: 3,
    clientId: 7,
    voucherType: "FACTURA_C",
    voucherNumber: null,
    concept: "PRODUCTOS",
    issueDate: new Date("2026-10-24T00:00:00.000Z"),
    recipientName: "Estudio García",
    recipientDocType: "CUIT",
    recipientDocNumber: "30712345678",
    recipientTaxCondition: "RESPONSABLE_INSCRIPTO",
    recipientAddress: null,
    caeExpiration: null,
    currency: "ARS",
    fiscalExchangeRate: "1",
    serviceFrom: null,
    serviceTo: null,
    paymentDueDate: null,
    totalAmount: "215.02",
    status: "DRAFT",
    cae: null,
    pointOfSale: { id: 3, number: 3 },
  });

  const post = () =>
    request(app).post("/api/invoices/99/authorize").set("Authorization", `Bearer ${token}`).send({});
  const useScenario = (scenario: SimulatedScenario) => {
    current.provider = new ArcaSimulatedClient({ scenario });
  };
  const updates = () => tx.invoice.update.mock.calls.map((call) => call[0].data as Record<string, unknown>);

  beforeEach(() => {
    vi.clearAllMocks();
    current.factoryError = null;
    useScenario("AUTHORIZED");
    row = draftRow();
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(org as never);
    tx.$queryRaw.mockImplementation(async () => [{ id: 99, status: row.status }]);
    tx.$executeRaw.mockResolvedValue(1);
    tx.invoice.aggregate.mockResolvedValue({ _max: { voucherNumber: null } });
    tx.invoice.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      row = { ...row, ...data };
      return row;
    });
    vi.mocked(prisma.invoice.findFirst).mockImplementation((async () => ({
      ...row,
      client: { id: 7, name: "Estudio García" },
      items: [],
      payments: [],
    })) as never);
  });

  it("copia los datos del emisor a la factura al reservarla y los devuelve en el detalle", async () => {
    const res = await post();

    expect(res.body.invoice.issuer).toEqual({
      cuit: "20000000001",
      legalName: "Recorrido SAS",
      tradeName: "Recorrido",
      address: "Av. Siempre Viva 742",
      taxCondition: "MONOTRIBUTO",
      grossIncomeNumber: "901-123456-7",
      activityStartDate: "2020-03-01",
    });
  });

  it("el detalle guarda y devuelve que la factura fue simulada (#135)", async () => {
    const res = await post();

    expect(res.body.invoice.simulated).toBe(true);
    expect(updates()[1]!.arcaResponse).toMatchObject({ simulated: true });
  });

  it("con un proveedor real el detalle no marca la factura como simulada", async () => {
    current.provider = {
      name: "proveedor-real",
      healthCheck: async () => ({ ok: true, detail: "" }),
      getLastAuthorized: async () => ({ voucherNumber: 0 }),
      requestCae: async () => ({
        outcome: "AUTHORIZED" as const,
        cae: "74123456789012",
        caeExpiration: "20261104",
        observations: [],
        errors: [],
        simulated: false,
      }),
    } satisfies FiscalProvider;
    const res = await post();

    expect(res.body.invoice.simulated).toBe(false);
  });

  it("un borrador no figura como simulado", async () => {
    row.status = "DRAFT";
    const detail = await request(app).get("/api/invoices/99").set("Authorization", `Bearer ${token}`);

    expect(detail.body.simulated).toBe(false);
  });

  it("el detalle trae lo necesario para armar el comprobante (receptor, punto de venta, fechas y vencimiento del CAE)", async () => {
    row.concept = "SERVICIOS";
    row.serviceFrom = new Date("2026-10-01T00:00:00.000Z");
    row.serviceTo = new Date("2026-10-31T00:00:00.000Z");
    row.paymentDueDate = new Date("2026-11-23T00:00:00.000Z");
    const res = await post();

    expect(res.body.invoice).toMatchObject({
      pointOfSale: 3,
      serviceFrom: "2026-10-01",
      serviceTo: "2026-10-31",
      paymentDueDate: "2026-11-23",
      recipient: {
        name: "Estudio García",
        docType: "CUIT",
        docNumber: "30712345678",
        taxCondition: "RESPONSABLE_INSCRIPTO",
        address: null,
      },
    });
    expect(res.body.invoice.caeExpiration).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("en un borrador el vencimiento del CAE y el número no existen todavía", async () => {
    row.status = "DRAFT";
    const detail = await request(app).get("/api/invoices/99").set("Authorization", `Bearer ${token}`);

    expect(detail.body.caeExpiration).toBeNull();
    expect(detail.body.voucherNumber).toBeNull();
    expect(detail.body.serviceFrom).toBeNull();
  });

  it("devuelve 401 sin token", async () => {
    const res = await request(app).post("/api/invoices/99/authorize");
    expect(res.status).toBe(401);
  });

  it("autoriza el borrador: lo reserva, numera, guarda CAE y devuelve la factura autorizada", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    const [reserve, authorize] = updates();
    expect(reserve).toEqual({
      status: "PENDING",
      issuerCuit: "20000000001",
      issuerLegalName: "Recorrido SAS",
      issuerTradeName: "Recorrido",
      issuerAddress: "Av. Siempre Viva 742",
      issuerTaxCondition: "MONOTRIBUTO",
      issuerGrossIncomeNumber: "901-123456-7",
      issuerActivityStartDate: new Date("2020-03-01T00:00:00.000Z"),
    });
    expect(authorize).toMatchObject({ status: "AUTHORIZED", voucherNumber: 1 });
    expect(authorize!.cae).toMatch(/^\d{14}$/);
    expect(authorize!.caeExpiration).toBeInstanceOf(Date);
    expect(authorize!.authorizedAt).toBeInstanceOf(Date);
    expect(res.body.invoice).toMatchObject({ invoiceId: 99, status: "AUTHORIZED", voucherNumber: 1 });
    expect(res.body.fiscal).toMatchObject({ outcome: "AUTHORIZED", simulated: true, errors: [] });
  });

  it("bloquea la fila (FOR UPDATE) y toma el bloqueo del punto de venta antes de numerar", async () => {
    await post();

    expect(String(tx.$queryRaw.mock.calls[0]![0].join(" "))).toMatch(/FOR UPDATE/);
    expect(String(tx.$executeRaw.mock.calls[0]![0].join(" "))).toMatch(/pg_advisory_xact_lock/);
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(2);
  });

  it("sigue la numeración de la base aunque el proveedor simulado haya reiniciado", async () => {
    tx.invoice.aggregate.mockResolvedValue({ _max: { voucherNumber: 4 } });
    const res = await post();

    expect(res.status).toBe(200);
    expect(updates()[1]).toMatchObject({ status: "AUTHORIZED", voucherNumber: 5 });
  });

  it("aprobada con observaciones queda autorizada y devuelve las observaciones", async () => {
    useScenario("WITH_OBSERVATIONS");
    const res = await post();

    expect(res.body.invoice.status).toBe("AUTHORIZED");
    expect(res.body.fiscal.outcome).toBe("AUTHORIZED_WITH_OBSERVATIONS");
    expect(res.body.fiscal.observations.length).toBeGreaterThan(0);
  });

  it("rechazada por ARCA queda REJECTED, sin CAE, con los errores guardados", async () => {
    useScenario("REJECTED");
    const res = await post();

    expect(res.status).toBe(200);
    const final = updates()[1]!;
    expect(final.status).toBe("REJECTED");
    expect(final).not.toHaveProperty("cae");
    expect(final.arcaResponse).toMatchObject({ outcome: "REJECTED" });
    expect(res.body.invoice.status).toBe("REJECTED");
    expect(res.body.fiscal.errors.length).toBeGreaterThan(0);
  });

  it("sin respuesta de ARCA la factura queda PENDING y responde 202", async () => {
    useScenario("TIMEOUT");
    const res = await post();

    expect(res.status).toBe(202);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]).toMatchObject({ status: "PENDING", issuerCuit: "20000000001" });
    expect(res.body.invoice.status).toBe("PENDING");
    expect(res.body.fiscal.outcome).toBe("INDETERMINATE");
  });

  it("si el proveedor falla de forma inesperada responde 502 y deja la factura PENDING", async () => {
    current.provider = {
      name: "roto",
      healthCheck: async () => ({ ok: false, detail: "" }),
      getLastAuthorized: async () => {
        throw new Error("ECONNRESET");
      },
      requestCae: async () => {
        throw new Error("no debería llamarse");
      },
    } satisfies FiscalProvider;
    const res = await post();

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/pendiente/i);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]).toMatchObject({ status: "PENDING" });
  });

  it("registra invoice.authorized en la auditoría con el CAE", async () => {
    await post();

    const audit = tx.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ action: "invoice.authorized", entity: "Invoice", entityId: 99, userId });
    expect(audit.metadata.voucherNumber).toBe(1);
  });

  it("un borrador de servicios sin fechas devuelve 400, queda en borrador y no llama al proveedor", async () => {
    row.concept = "SERVICIOS";
    const requestCae = vi.spyOn(current.provider as ArcaSimulatedClient, "requestCae");
    const res = await post();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/serviceStartDate/);
    expect(requestCae).not.toHaveBeenCalled();
    // La reserva (DRAFT -> PENDING) corre en una transacción: al fallar, se deshace entera
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("devuelve 409 si la factura ya no está en borrador y no llama al proveedor", async () => {
    row.status = "AUTHORIZED";
    const requestCae = vi.spyOn(current.provider as ArcaSimulatedClient, "requestCae");
    const res = await post();

    expect(res.status).toBe(409);
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(requestCae).not.toHaveBeenCalled();
  });

  it("devuelve 404 si la factura no existe en la organización", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    const res = await post();
    expect(res.status).toBe(404);
  });

  it("devuelve 403 si el usuario todavía no tiene organización", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(403);
  });

  it("devuelve 503 sin tocar la factura si el proveedor fiscal no se puede armar", async () => {
    current.factoryError = new Error("ARCA_PROVIDER=sdk necesita las credenciales");
    const res = await post();

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/proveedor fiscal/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rechaza un ID de factura inválido", async () => {
    const res = await request(app).post("/api/invoices/abc/authorize").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
