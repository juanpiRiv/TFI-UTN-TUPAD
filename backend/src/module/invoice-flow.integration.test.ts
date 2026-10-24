import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isValidCuit } from "../lib/cuit.js";

let app: any;
let prisma: any;
let dbAvailable = false;

// Como el resto de las suites de integración: sin DATABASE_URL, JWT_SECRET y PostgreSQL se saltea.
// El proveedor fiscal que se usa es el de ARCA_PROVIDER (simulated en desarrollo y CI).
if (process.env.DATABASE_URL && process.env.JWT_SECRET && process.env.ARCA_PROVIDER === "simulated") {
  try {
    prisma = (await import("../lib/prisma.js")).prisma;
    await prisma.$queryRaw`SELECT 1`;
    app = (await import("../app.js")).app;
    dbAvailable = true;
  } catch {
    console.warn("⚠️ PostgreSQL no disponible para el recorrido facturar y cobrar");
  }
}

/** CUIT válido y distinto en cada llamada (módulo 11). */
let cuitSeed = (Date.now() + process.pid * 7919) % 100_000_000;
function nextCuit(): string {
  for (;;) {
    cuitSeed = (cuitSeed + 104_729) % 100_000_000;
    const base = `20${String(cuitSeed).padStart(8, "0")}`;
    for (let digit = 0; digit <= 9; digit++) {
      if (isValidCuit(`${base}${digit}`)) return `${base}${digit}`;
    }
  }
}

const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!dbAvailable)("Recorrido facturar y cobrar contra PostgreSQL real (Issues #64, #59)", () => {
  const email = `facturar-${Date.now()}-${process.pid}@test.com`;
  let token = "";
  let userId = 0;
  let orgId = 0;
  let clientId = 0;
  let firstInvoiceId = 0;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const api = {
    post: (path: string, body: object = {}) => request(app).post(path).set(auth()).send(body),
    get: (path: string) => request(app).get(path).set(auth()),
  };
  const newInvoice = async (price = 250000) => {
    const res = await api.post("/api/invoices", {
      clientId,
      concept: "PRODUCTOS",
      issueDate: today(),
      items: [{ description: "Consultoría técnica", quantity: 1, unitPrice: price }],
    });
    expect(res.status).toBe(201);
    return res.body.invoiceId as number;
  };

  beforeAll(async () => {
    const register = await request(app).post("/api/auth/register").send({ email, password: "Password123!" });
    token = register.body.token;
    userId = register.body.user.id;
    const org = await api.post("/api/organizations", {
      cuit: nextCuit(),
      legalName: "Recorrido Facturar SAS",
      taxCondition: "MONOTRIBUTO",
      baseCurrency: "ARS",
    });
    orgId = org.body.id;
    // La organización todavía no trae punto de venta propio: se usa el que haya o se crea el N° 1.
    const existing = await prisma.pointOfSale.findFirst({ where: { organizationId: orgId } });
    if (!existing) await prisma.pointOfSale.create({ data: { organizationId: orgId, number: 1 } });
    const client = await api.post("/api/clients", {
      name: "Estudio García",
      docType: "CUIT",
      docNumber: nextCuit(),
      taxCondition: "RESPONSABLE_INSCRIPTO",
    });
    clientId = client.body.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.transaction.deleteMany({ where: { organizationId: orgId } });
      await prisma.payment.deleteMany({ where: { invoice: { organizationId: orgId } } });
      await prisma.invoice.deleteMany({ where: { organizationId: orgId } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: orgId }, { userId }] } });
      await prisma.activity.deleteMany({ where: { organizationId: orgId } });
      await prisma.pointOfSale.deleteMany({ where: { organizationId: orgId } });
      await prisma.client.deleteMany({ where: { organizationId: orgId } });
      await prisma.category.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch (error) {
      console.warn("No se pudo limpiar el recorrido facturar y cobrar:", error);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("1. crea un borrador: el backend calcula el total y copia los datos del cliente", async () => {
    firstInvoiceId = await newInvoice(250000);

    const detail = await api.get(`/api/invoices/${firstInvoiceId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      status: "DRAFT",
      totalAmount: "250000.00",
      pendingBalance: "250000.00",
      recipientName: "Estudio García",
      voucherNumber: null,
    });
  });

  it("2. no se puede cobrar un borrador", async () => {
    const res = await api.post(`/api/invoices/${firstInvoiceId}/payments`, {
      amount: "1000.00",
      paymentDate: today(),
      currency: "ARS",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("3. facturar autoriza el borrador con el proveedor simulado y le da el número 1", async () => {
    const res = await api.post(`/api/invoices/${firstInvoiceId}/authorize`);

    expect(res.status).toBe(200);
    expect(res.body.fiscal).toMatchObject({ outcome: "AUTHORIZED", simulated: true });
    expect(res.body.invoice).toMatchObject({ status: "AUTHORIZED", voucherNumber: 1 });
    expect(res.body.invoice.cae).toMatch(/^\d{14}$/);
  });

  it("4. facturar de nuevo la misma factura devuelve 409", async () => {
    const res = await api.post(`/api/invoices/${firstInvoiceId}/authorize`);
    expect(res.status).toBe(409);
  });

  it("5. un cobro parcial deja la factura cobrada en parte y el saldo correcto", async () => {
    const pay = await api.post(`/api/invoices/${firstInvoiceId}/payments`, {
      amount: "100000.00",
      paymentDate: today(),
      currency: "ARS",
    });
    expect(pay.status).toBe(201);

    const detail = await api.get(`/api/invoices/${firstInvoiceId}`);
    expect(detail.body).toMatchObject({
      commercialStatus: "PARTIALLY_PAID",
      totalPaid: "100000.00",
      pendingBalance: "150000.00",
    });
  });

  it("6. un cobro que supera el saldo se rechaza y el saldo no cambia", async () => {
    const res = await api.post(`/api/invoices/${firstInvoiceId}/payments`, {
      amount: "200000.00",
      paymentDate: today(),
      currency: "ARS",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const detail = await api.get(`/api/invoices/${firstInvoiceId}`);
    expect(detail.body.pendingBalance).toBe("150000.00");
  });

  it("7. dos cobros simultáneos que juntos superan el saldo: solo uno entra (FOR UPDATE)", async () => {
    const [a, b] = await Promise.all([
      api.post(`/api/invoices/${firstInvoiceId}/payments`, { amount: "150000.00", paymentDate: today(), currency: "ARS" }),
      api.post(`/api/invoices/${firstInvoiceId}/payments`, { amount: "150000.00", paymentDate: today(), currency: "ARS" }),
    ]);

    expect([a.status, b.status].filter((status) => status === 201)).toHaveLength(1);
    const detail = await api.get(`/api/invoices/${firstInvoiceId}`);
    expect(detail.body).toMatchObject({ commercialStatus: "PAID", pendingBalance: "0.00", totalPaid: "250000.00" });
  });

  it("8. la numeración sigue correlativa: la segunda factura recibe el número 2", async () => {
    const secondId = await newInvoice(80000);
    const res = await api.post(`/api/invoices/${secondId}/authorize`);

    expect(res.status).toBe(200);
    expect(res.body.invoice.voucherNumber).toBe(2);
  });

  it("9. dos pedidos simultáneos de facturar el mismo borrador: solo uno autoriza", async () => {
    const draftId = await newInvoice(5000);
    const [a, b] = await Promise.all([
      api.post(`/api/invoices/${draftId}/authorize`),
      api.post(`/api/invoices/${draftId}/authorize`),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const detail = await api.get(`/api/invoices/${draftId}`);
    expect(detail.body).toMatchObject({ status: "AUTHORIZED", voucherNumber: 3 });
  });

  it("10. el dashboard refleja lo facturado y lo cobrado", async () => {
    const res = await api.get(`/api/dashboard/summary?from=${today()}&to=${today()}`);

    expect(res.status).toBe(200);
    // 250.000 + 80.000 + 5.000 facturados; solo se cobraron los 250.000 de la primera
    expect(res.body).toMatchObject({ invoiced: "335000.00", collected: "250000.00", difference: "85000.00" });
  });

  it("11. el emisor queda copiado en la factura: editar la organización después no lo cambia (#95)", async () => {
    const before = await api.get(`/api/invoices/${firstInvoiceId}`);
    expect(before.body.issuer).toMatchObject({ legalName: "Recorrido Facturar SAS", taxCondition: "MONOTRIBUTO" });

    const edit = await request(app).patch("/api/organizations/me").set(auth()).send({ legalName: "Otro Nombre SRL" });
    expect(edit.status).toBe(200);

    const after = await api.get(`/api/invoices/${firstInvoiceId}`);
    expect(after.body.issuer.legalName).toBe("Recorrido Facturar SAS");
  });

  it("12. la base exige los datos del emisor fuera de borrador y rechaza una organización con base distinta de ARS (#95, #96)", async () => {
    const draftId = await newInvoice(1000);
    await expect(
      prisma.invoice.update({ where: { id: draftId }, data: { status: "PENDING" } }),
    ).rejects.toThrow(/invoices_issuer_required_after_draft/);

    await expect(
      prisma.$executeRaw`UPDATE organizations SET base_currency = 'USD' WHERE id = ${orgId}`,
    ).rejects.toThrow(/organizations_base_currency_ars/);
  });

  it("13. no puede haber dos actividades primarias en la misma organización (#99)", async () => {
    await prisma.activity.create({
      data: { organizationId: orgId, description: "Desarrollo de software", kind: "SERVICES", isPrimary: true },
    });
    await expect(
      prisma.activity.create({
        data: { organizationId: orgId, description: "Soporte", kind: "SERVICES", isPrimary: true },
      }),
    ).rejects.toThrow(/activities_one_primary_per_org|Unique constraint/);

    // Las secundarias no tienen límite
    await prisma.activity.create({
      data: { organizationId: orgId, description: "Capacitación", kind: "SERVICES", isPrimary: false },
    });
    await prisma.activity.create({
      data: { organizationId: orgId, description: "Consultoría", kind: "SERVICES", isPrimary: false },
    });
  });

  it("14. quedó registrada la auditoría de crear, autorizar y cobrar", async () => {
    const actions: { action: string }[] = await prisma.auditLog.findMany({
      where: { organizationId: orgId },
      select: { action: true },
    });
    const names = new Set(actions.map((row) => row.action));

    for (const expected of ["invoice.created", "invoice.authorized", "payment.created"]) {
      expect(names.has(expected)).toBe(true);
    }
  });
});
