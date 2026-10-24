import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { isValidCuit } from "../lib/cuit.js";

let app: any;
let prisma: any;
let dbAvailable = false;

// Como el resto de las suites de integración: sin DATABASE_URL, JWT_SECRET y PostgreSQL se saltea.
if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
  try {
    prisma = (await import("../lib/prisma.js")).prisma;
    await prisma.$queryRaw`SELECT 1`;
    app = (await import("../app.js")).app;
    dbAvailable = true;
  } catch {
    console.warn("⚠️ PostgreSQL no disponible para el test de recorrido");
  }
}

/**
 * Test de recorrido E2E completo contra el backend real (PostgreSQL + Express), sin mocks MSW.
 * Criterio de cierre Issue #108:
 * "Un test de recorrido (registro, organización, cliente, movimiento, dashboard) pasa contra el backend real, sin mocks."
 */
describe.skipIf(!dbAvailable)("Recorrido funcional completo contra Backend Real sin mocks (Issue #108)", () => {
  const timestamp = Date.now();
  const testEmail = `recorrido-${timestamp}@test.com`;
  const testPassword = "Password123!";

  // Generador determinístico de CUITs válidos según algoritmo módulo 11 de AFIP/ARCA
  function generateValidCuit(seedNumber: number): string {
    const raw = String(seedNumber).padStart(8, "0").slice(-8);
    const base = `20${raw}`;
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const digits = base.split("").map(Number);
    const sum = weights.reduce((acc, w, i) => acc + w * (digits[i] ?? 0), 0);
    const rem = 11 - (sum % 11);
    const dv = rem === 11 ? 0 : rem === 10 ? 9 : rem;
    const cuit = `${base}${dv}`;
    if (!isValidCuit(cuit)) {
      throw new Error(`CUIT generado invalido: ${cuit}`);
    }
    return cuit;
  }

  const orgCuit = generateValidCuit(timestamp % 100000000);
  const clientCuit = generateValidCuit((timestamp + 777) % 100000000);

  let authToken: string;
  let createdUserId: number;
  let createdOrgId: number;
  let createdClientId: number;
  let incomeCategoryId: number;
  let createdTxId: number;

  afterAll(async () => {
    try {
      if (createdTxId) {
        await prisma.transaction.deleteMany({ where: { id: createdTxId } });
      }
      if (createdClientId) {
        await prisma.client.deleteMany({ where: { id: createdClientId } });
      }
      // La auditoría referencia a la organización y al usuario: va antes de borrarlos.
      await prisma.auditLog.deleteMany({
        where: { OR: [{ organizationId: createdOrgId ?? -1 }, { userId: createdUserId ?? -1 }] },
      });
      if (createdOrgId) {
        await prisma.pointOfSale.deleteMany({ where: { organizationId: createdOrgId } });
        await prisma.category.deleteMany({ where: { organizationId: createdOrgId } });
        await prisma.organization.deleteMany({ where: { id: createdOrgId } });
      }
      if (createdUserId) {
        await prisma.user.deleteMany({ where: { id: createdUserId } });
      }
      await prisma.$disconnect();
    } catch {
      // Ignorar errores de limpieza
    }
  });

  it("1. Registro: permite dar de alta un nuevo usuario en la base de datos real", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: testEmail,
        password: testPassword,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("user");
    expect(res.body.user).toHaveProperty("id");
    expect(res.body.user.email).toBe(testEmail.toLowerCase());
    expect(res.body).toHaveProperty("token");

    createdUserId = res.body.user.id;
    authToken = res.body.token;
  });

  it("2. Login: autentica al usuario registrado y emite un token JWT válido", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: testEmail,
        password: testPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body).toHaveProperty("user");
    expect(res.body.user.id).toBe(createdUserId);

    authToken = res.body.token;
    expect(typeof authToken).toBe("string");
  });

  it("3. Organización (Onboarding): crea la organización monotributista y categorías predeterminadas", async () => {
    const res = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        cuit: orgCuit,
        legalName: "Servicios Digitales Recorrido SAS",
        taxCondition: "MONOTRIBUTO",
        baseCurrency: "ARS",
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.cuit).toBe(orgCuit);
    expect(res.body.legalName).toBe("Servicios Digitales Recorrido SAS");
    expect(res.body.baseCurrency).toBe("ARS");

    createdOrgId = res.body.id;

    // Verificar que se crearon categorías automáticas para la organización
    const categoriesRes = await request(app)
      .get("/api/categories")
      .set("Authorization", `Bearer ${authToken}`);

    expect(categoriesRes.status).toBe(200);
    expect(Array.isArray(categoriesRes.body)).toBe(true);
    expect(categoriesRes.body.length).toBeGreaterThan(0);

    const incomeCat = categoriesRes.body.find((c: any) => c.type === "INCOME");
    expect(incomeCat).toBeDefined();
    incomeCategoryId = incomeCat.id;
  });

  it("4. Cliente: permite crear un cliente asociado a la organización", async () => {
    const res = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Cliente Recorrido Final SA",
        docType: "CUIT",
        docNumber: clientCuit,
        taxCondition: "RESPONSABLE_INSCRIPTO",
        email: "cliente.final@recorrido.com",
        address: "Av. Corrientes 1234, CABA",
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.name).toBe("Cliente Recorrido Final SA");
    expect(res.body.docNumber).toBe(clientCuit);

    createdClientId = res.body.id;
  });

  it("5. Movimiento: registra un ingreso manual con fecha e importe en la base real", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        type: "INCOME",
        amount: "125000.00",
        currency: "ARS",
        categoryId: incomeCategoryId,
        clientId: createdClientId,
        transactionDate: "2026-10-15",
        description: "Honorarios de consultoria mes de octubre",
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(Number(res.body.amount)).toBe(125000);
    expect(res.body.type).toBe("INCOME");
    expect(res.body.currency).toBe("ARS");

    createdTxId = res.body.id;
  });

  it("6. Dashboard: consolida las cifras del recorrido en tiempo real desde la base de datos", async () => {
    const res = await request(app)
      .get("/api/dashboard/summary?from=2026-10-01&to=2026-10-31")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("income");
    expect(res.body).toHaveProperty("expense");
    expect(res.body).toHaveProperty("net");
    expect(res.body).toHaveProperty("transactionCount");

    // El ingreso registrado de $125.000 debe reflejarse en el dashboard
    expect(Number(res.body.income)).toBeGreaterThanOrEqual(125000);
    expect(Number(res.body.net)).toBeGreaterThanOrEqual(125000);
    expect(res.body.transactionCount).toBeGreaterThanOrEqual(1);
  });
});
