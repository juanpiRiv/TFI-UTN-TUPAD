import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uniqueCuit } from "../../test-utils/unique-cuit.js";

let app: any;
let prisma: any;
let dbAvailable = false;

if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
  try {
    prisma = (await import("../../lib/prisma.js")).prisma;
    await prisma.$queryRaw`SELECT 1`;
    app = (await import("../../app.js")).app;
    dbAvailable = true;
  } catch {
    console.warn("PostgreSQL no disponible para los tests de completitud del emisor");
  }
}

describe.skipIf(!dbAvailable)("completitud del emisor en /organizations/me (base real)", () => {
  const email = `issuer-edge-${Date.now()}@test.com`;
  let token: string;
  let userId: number;
  let orgId: number;
  const as = () => ({ Authorization: `Bearer ${token}` });
  const me = async () => (await request(app).get("/api/organizations/me").set(as())).body;
  const patch = (body: Record<string, unknown>) => request(app).patch("/api/organizations/me").set(as()).send(body);

  beforeAll(async () => {
    token = (await request(app).post("/api/auth/register").send({ email, password: "password-1" })).body.token;
    userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    const res = await request(app).post("/api/organizations").set(as()).send({
      cuit: uniqueCuit("20"),
      legalName: "Emisor Completo SRL",
      commercialAddress: "Av. Siempre Viva 742",
      taxCondition: "RESPONSABLE_INSCRIPTO",
      activityStartDate: "2020-03-01",
      grossIncomeNumber: "901-123456-7",
      baseCurrency: "ARS",
    });
    expect(res.status).toBe(201);
    orgId = res.body.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId }, { organizationId: orgId }] } });
    await prisma.pointOfSale.deleteMany({ where: { organizationId: orgId } });
    await prisma.category.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("GET /me trae issuerCompleteness con la forma { complete, missing: [{ field, label }] }", async () => {
    const body = await me();
    expect(body.issuerCompleteness).toEqual({ complete: true, missing: [] });
    expect(Object.keys(body.issuerCompleteness).sort()).toEqual(["complete", "missing"]);
  });

  it.each([
    ["commercialAddress", "", "Domicilio comercial"],
    ["commercialAddress", "    ", "Domicilio comercial"],
    ["commercialAddress", null, "Domicilio comercial"],
    ["activityStartDate", "", "Fecha de inicio de actividades"],
    ["activityStartDate", null, "Fecha de inicio de actividades"],
    ["grossIncomeNumber", "   ", "Ingresos Brutos (número, Exento o Convenio)"],
    ["grossIncomeNumber", null, "Ingresos Brutos (número, Exento o Convenio)"],
  ])("un PATCH que deja %s en %j pasa la organización de completa a incompleta", async (field, value, label) => {
    const original = { commercialAddress: "Av. Siempre Viva 742", activityStartDate: "2020-03-01", grossIncomeNumber: "901-123456-7" } as Record<string, string>;
    try {
      expect((await patch({ [field]: value })).status).toBe(200);
      expect((await me()).issuerCompleteness).toEqual({ complete: false, missing: [{ field, label }] });
    } finally {
      await patch({ [field]: original[field] });
    }
    expect((await me()).issuerCompleteness.complete).toBe(true);
  });

  it("pasar a MONOTRIBUTO quita la exigencia de Ingresos Brutos, y volver a inscripto la restituye", async () => {
    try {
      await patch({ grossIncomeNumber: null });
      expect((await me()).issuerCompleteness.missing.map((m: { field: string }) => m.field)).toEqual(["grossIncomeNumber"]);

      expect((await patch({ taxCondition: "MONOTRIBUTO", monotributoCategory: "B" })).status).toBe(200);
      expect((await me()).issuerCompleteness).toEqual({ complete: true, missing: [] });

      expect((await patch({ taxCondition: "RESPONSABLE_INSCRIPTO" })).status).toBe(200);
      expect((await me()).issuerCompleteness.missing.map((m: { field: string }) => m.field)).toEqual(["grossIncomeNumber"]);
    } finally {
      await patch({ taxCondition: "RESPONSABLE_INSCRIPTO", grossIncomeNumber: "901-123456-7" });
    }
  });

  it("varios campos en blanco a la vez se listan en el orden del comprobante", async () => {
    try {
      await patch({ commercialAddress: null, activityStartDate: null, grossIncomeNumber: null });
      expect((await me()).issuerCompleteness.missing.map((m: { field: string }) => m.field)).toEqual(["commercialAddress", "activityStartDate", "grossIncomeNumber"]);
    } finally {
      await patch({ commercialAddress: "Av. Siempre Viva 742", activityStartDate: "2020-03-01", grossIncomeNumber: "901-123456-7" });
    }
  });

  it("el estado de completitud sale de la fila guardada: la razón social no se puede dejar en blanco por PATCH", async () => {
    const res = await patch({ legalName: "   " });
    expect(res.status).toBe(400);
    expect((await me()).issuerCompleteness.complete).toBe(true);
  });

  it("el PATCH no devuelve issuerCompleteness (solo el GET) y no cambia el estado de la respuesta de siempre", async () => {
    const res = await patch({ tradeName: "Nombre de fantasía" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orgId);
  });
});
