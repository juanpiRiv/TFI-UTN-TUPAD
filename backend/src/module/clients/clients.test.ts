import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isValidCuit } from "../../lib/cuit.js";

let app: any;
let prisma: any;
let dbAvailable = false;

// Como el resto de las suites de integración: sin DATABASE_URL, JWT_SECRET y PostgreSQL se saltea.
if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
  try {
    prisma = (await import("../../lib/prisma.js")).prisma;
    await prisma.$queryRaw`SELECT 1`;
    app = (await import("../../app.js")).app;
    dbAvailable = true;
  } catch {
    console.warn("⚠️ PostgreSQL no disponible para los tests de clientes");
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

describe.skipIf(!dbAvailable)("clients (integration)", () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const emails = [`cli-a-${stamp}@test.com`, `cli-b-${stamp}@test.com`, `cli-sin-org-${stamp}@test.com`];
  let tokenA = "";
  let tokenB = "";
  let tokenNoOrg = "";
  let clientId = 0;
  const docNumber = nextCuit();

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const body = (over: object = {}) => ({
    name: "Estudio García",
    docType: "CUIT",
    docNumber,
    taxCondition: "RESPONSABLE_INSCRIPTO",
    ...over,
  });

  beforeAll(async () => {
    const [a, b, c] = await Promise.all(
      emails.map((email) => request(app).post("/api/auth/register").send({ email, password: "Password123!" })),
    );
    tokenA = a!.body.token;
    tokenB = b!.body.token;
    tokenNoOrg = c!.body.token;
    for (const token of [tokenA, tokenB]) {
      const org = await request(app)
        .post("/api/organizations")
        .set(as(token))
        .send({ cuit: nextCuit(), legalName: "Org de prueba", taxCondition: "MONOTRIBUTO", baseCurrency: "ARS" });
      expect(org.status).toBe(201);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const userIds = users.map((user: { id: number }) => user.id);
    const orgs = await prisma.organization.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const orgIds = orgs.map((org: { id: number }) => org.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.client.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.pointOfSale.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.category.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("exige token (401) y organización (403)", async () => {
    expect((await request(app).get("/api/clients")).status).toBe(401);
    expect((await request(app).post("/api/clients").send(body())).status).toBe(401);
    expect((await request(app).get("/api/clients").set(as(tokenNoOrg))).status).toBe(403);
  });

  it("crea un cliente con sus datos", async () => {
    const res = await request(app).post("/api/clients").set(as(tokenA)).send(body());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Estudio García", docType: "CUIT", docNumber, isActive: true });
    clientId = res.body.id;
  });

  it("no deja repetir el documento dentro de la organización (409), pero otra organización sí puede usarlo", async () => {
    const repeated = await request(app).post("/api/clients").set(as(tokenA)).send(body({ name: "Otro nombre" }));
    const otherOrg = await request(app).post("/api/clients").set(as(tokenB)).send(body());

    expect(repeated.status).toBe(409);
    expect(otherOrg.status).toBe(201);
  });

  it("valida los datos: nombre obligatorio y CUIT con dígito verificador (400)", async () => {
    const noName = await request(app).post("/api/clients").set(as(tokenA)).send(body({ name: "" }));
    const badCuit = await request(app)
      .post("/api/clients")
      .set(as(tokenA))
      .send(body({ docNumber: "20123456780" }));

    expect(noName.status).toBe(400);
    expect(badCuit.status).toBe(400);
  });

  it("lista y busca por nombre", async () => {
    const all = await request(app).get("/api/clients").set(as(tokenA));
    const found = await request(app).get(`/api/clients?search=${encodeURIComponent("García")}`).set(as(tokenA));
    const none = await request(app).get("/api/clients?search=zzz-no-existe").set(as(tokenA));

    expect(all.status).toBe(200);
    expect(all.body.map((client: { id: number }) => client.id)).toContain(clientId);
    expect(found.body.map((client: { id: number }) => client.id)).toContain(clientId);
    expect(none.body).toEqual([]);
  });

  it("edita un cliente", async () => {
    const res = await request(app).patch(`/api/clients/${clientId}`).set(as(tokenA)).send({ name: "Estudio García y Asociados" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Estudio García y Asociados");
  });

  it("no deja ver ni editar un cliente de otra organización (404)", async () => {
    expect((await request(app).get(`/api/clients/${clientId}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).patch(`/api/clients/${clientId}`).set(as(tokenB)).send({ name: "Robado" })).status).toBe(404);

    const mine = await request(app).get(`/api/clients/${clientId}`).set(as(tokenA));
    expect(mine.body.name).toBe("Estudio García y Asociados");
  });

  it("la baja es lógica: el cliente deja de listarse pero se conserva", async () => {
    const down = await request(app).patch(`/api/clients/${clientId}`).set(as(tokenA)).send({ isActive: false });
    expect(down.status).toBe(200);

    const active = await request(app).get("/api/clients").set(as(tokenA));
    const withInactive = await request(app).get("/api/clients?includeInactive=true").set(as(tokenA));

    expect(active.body.map((client: { id: number }) => client.id)).not.toContain(clientId);
    expect(withInactive.body.map((client: { id: number }) => client.id)).toContain(clientId);
    expect(await prisma.client.findUnique({ where: { id: clientId } })).not.toBeNull();
  });

  it("rechaza un ID inválido con 400", async () => {
    expect((await request(app).get("/api/clients/abc").set(as(tokenA))).status).toBe(400);
  });
});
