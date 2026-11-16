/**
 * Modo delegado de ARCA contra la base real y por HTTP. El cliente de ARCA es el real (ArcaSdkClient) pero su capa de
 * red se reemplaza por un doble: lo que se prueba es qué CUIT llega a cada llamada, no ARCA.
 */
import "dotenv/config";
import request from "supertest";
import { ArcaAuthenticationError } from "facturas";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uniqueCuit } from "../../test-utils/unique-cuit.js";
import { signCsr } from "../../test-utils/arca-fixtures.js";

vi.hoisted(() => {
  process.env.ARCA_ENCRYPTION_KEY = "c".repeat(64);
  process.env.ARCA_PROVIDER ??= "simulated";
});

const wsfe = vi.hoisted(() => ({ getNextVoucherNumber: vi.fn(), issue: vi.fn(), getServerStatus: vi.fn() }));

// Mismo ArcaSdkClient de siempre; solo cambia la construcción del cliente de red de la librería.
vi.mock("../arca/sdk/arca-sdk-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../arca/sdk/arca-sdk-client.js")>();
  class DoubledSdkClient extends actual.ArcaSdkClient {
    constructor(options: ConstructorParameters<typeof actual.ArcaSdkClient>[0]) {
      super({ ...options, clientFactory: () => ({ wsfe }) as never });
    }
  }
  return { ...actual, ArcaSdkClient: DoubledSdkClient };
});

let app: any;
let prisma: any;
let env: Record<string, string | undefined>;
let dbAvailable = false;

if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
  try {
    prisma = (await import("../../lib/prisma.js")).prisma;
    await prisma.$queryRaw`SELECT 1`;
    app = (await import("../../app.js")).app;
    env = (await import("../../config/env.js")).env as never;
    dbAvailable = true;
  } catch {
    console.warn("PostgreSQL no disponible para los tests del modo delegado de ARCA");
  }
}

const { generateCsr } = await import("../arca/arca-csr.service.js");
const { resetVerifyLimits, verifyArcaDelegation } = await import("../arca/arca-delegation.service.js");
const { resetOrganizationProviders } = await import("../arca/provider-for-organization.js");
const { resetFiscalProviderCache } = await import("../arca/provider-from-env.js");

const route = "/api/organizations/me/arca-delegation";
const PLATFORM_CUIT = "20345678906";
const stamp = Date.now();
const NOT_DELEGATED = `Todavía no figura la delegación en ARCA. Revisá que delegaste «Facturación Electrónica» al CUIT ${PLATFORM_CUIT} y volvé a verificar.`;
const UNAVAILABLE = "La conexión por delegación no está disponible en este momento.";

describe.skipIf(!dbAvailable)("Modo delegado de ARCA (base real, HTTP)", () => {
  const sentBodies: string[] = [];
  const logLines: string[] = [];
  const userIds: number[] = [];
  const orgIds: number[] = [];
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  const saved: Record<string, string | undefined> = {};
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let platformCertPem = "";
  let platformKeyPem = "";

  interface Tenant {
    token: string;
    userId: number;
    orgId: number;
    cuit: string;
  }

  const KEYS = ["NODE_ENV", "ARCA_PLATFORM_OWNER_EMAILS", "ARCA_PROVIDER", "ARCA_MODE", "ARCA_ALLOW_PRODUCTION", "ARCA_DELEGATION", "ARCA_CUIT", "ARCA_CERT_PEM", "ARCA_KEY_PEM", "ARCA_CERT_PATH", "ARCA_KEY_PATH"];
  const configure = (over: Record<string, string | undefined> = {}) => {
    Object.assign(env, { NODE_ENV: "test", ARCA_PLATFORM_OWNER_EMAILS: undefined, ARCA_PROVIDER: "sdk", ARCA_MODE: "homologacion", ARCA_ALLOW_PRODUCTION: undefined, ARCA_DELEGATION: "true", ARCA_CUIT: PLATFORM_CUIT, ARCA_CERT_PEM: platformCertPem, ARCA_KEY_PEM: platformKeyPem, ARCA_CERT_PATH: undefined, ARCA_KEY_PATH: undefined }, over);
  };

  beforeAll(async () => {
    for (const method of ["error", "warn", "log"] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logLines.push(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}\n${arg.stack}` : String(arg))).join(" "))));
    }
    for (const key of KEYS) saved[key] = env[key];
    const { csr, privateKeyPem } = await generateCsr({ legalName: "Plataforma de prueba", cuit: PLATFORM_CUIT });
    platformCertPem = await signCsr(csr, { cuit: PLATFORM_CUIT });
    platformKeyPem = privateKeyPem;
  });

  beforeEach(() => {
    configure();
    resetOrganizationProviders();
    resetFiscalProviderCache();
    resetVerifyLimits();
    wsfe.getNextVoucherNumber.mockReset().mockResolvedValue(1);
    wsfe.issue.mockReset();
  });

  afterEach(() => {
    resetOrganizationProviders();
  });

  afterAll(async () => {
    spies.forEach((spy) => spy.mockRestore());
    for (const key of KEYS) env[key] = saved[key];
    // Ninguna respuesta ni registro del servidor contiene claves, variables ni el certificado.
    for (const body of sentBodies) {
      expect(body).not.toContain("PRIVATE KEY");
      expect(body).not.toContain("-----BEGIN");
      expect(body).not.toMatch(/ARCA_[A-Z_]+/);
      expect(body).not.toMatch(/\.pem|docs\//);
    }
    for (const line of logLines) {
      expect(line).not.toContain("PRIVATE KEY");
      expect(line).not.toContain("-----BEGIN");
    }
    if (!prisma) return;
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }] } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
    await prisma.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.arcaDelegation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.pointOfSale.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.category.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function call(method: "get" | "post" | "delete", path: string, token?: string, keepLimits = false) {
    // El límite de una verificación cada 15 s no tiene que estorbar a los tests que verifican varias veces seguidas.
    if (path === "/verify" && !keepLimits) resetVerifyLimits();
    let pending = request(app)[method](`${route}${path}`);
    if (token) pending = pending.set(as(token));
    const res = await pending;
    sentBodies.push(res.text);
    return res;
  }

  let counter = 0;
  async function newUser(): Promise<{ token: string; userId: number }> {
    const email = `arca-deleg-${stamp}-${counter++}@test.com`;
    const res = await request(app).post("/api/auth/register").send({ email, password: "password-1" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);
    return { token: res.body.token, userId: user.id };
  }

  async function newTenant(opts: { pointOfSale?: boolean } = {}): Promise<Tenant> {
    const { token, userId } = await newUser();
    const cuit = uniqueCuit("27");
    const res = await request(app).post("/api/organizations").set(as(token)).send({
      cuit,
      legalName: "Panadería Sur",
      taxCondition: "MONOTRIBUTO",
      monotributoCategory: "B",
      activityStartDate: "2024-03-01",
      commercialAddress: "Av. Siempre Viva 742",
      baseCurrency: "ARS",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    orgIds.push(res.body.id);
    // Crear la organización ya crea el punto de venta 1.
    if (opts.pointOfSale === false) await prisma.pointOfSale.deleteMany({ where: { organizationId: res.body.id } });
    return { token, userId, orgId: res.body.id, cuit };
  }

  const row = (orgId: number) => prisma.arcaDelegation.findUnique({ where: { organizationId: orgId } });
  const audits = async (orgId: number) => (await prisma.auditLog.findMany({ where: { organizationId: orgId, action: { startsWith: "arca_delegation." } }, orderBy: { id: "asc" } })).map((a: { action: string }) => a.action);
  const notDelegated = () => wsfe.getNextVoucherNumber.mockRejectedValue(new ArcaAuthenticationError("ARCA rejected authentication", { reason: "missing_relationship", service: "wsfe", operation: "FECompUltimoAutorizado", providerCode: "600" }));

  describe("autenticación", () => {
    it.each([["get", ""], ["post", "/verify"], ["delete", ""]] as const)("%s %s sin token responde 401", async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
    });

    it.each([["get", ""], ["post", "/verify"], ["delete", ""]] as const)("%s %s con un usuario sin organización responde 403", async (method, path) => {
      const { token } = await newUser();
      expect((await call(method, path, token)).status).toBe(403);
    });
  });

  describe("GET: disponibilidad y estado", () => {
    it("disponible: informa el CUIT de la plataforma y que todavía no se empezó", async () => {
      const tenant = await newTenant();

      const res = await call("get", "", tenant.token);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true, platformCuit: PLATFORM_CUIT, status: "NOT_STARTED" });
    });

    it.each([
      ["ARCA_DELEGATION apagada", { ARCA_DELEGATION: undefined }],
      ["ARCA_DELEGATION distinta de true", { ARCA_DELEGATION: "1" }],
      ["sin certificado de la plataforma", { ARCA_CERT_PEM: undefined, ARCA_KEY_PEM: undefined }],
      ["certificado ilegible", { ARCA_CERT_PEM: "no es un certificado" }],
      ["proveedor simulado", { ARCA_PROVIDER: "simulated" }],
    ])("%s: available false, sin CUIT de la plataforma ni el motivo", async (_name, over) => {
      configure(over);
      const tenant = await newTenant();

      const res = await call("get", "", tenant.token);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: false, status: "NOT_STARTED" });
    });

    it("en producción sin ARCA_ALLOW_PRODUCTION no está disponible; confirmada, sí", async () => {
      const tenant = await newTenant();
      configure({ ARCA_MODE: "produccion" });
      expect((await call("get", "", tenant.token)).body.available).toBe(false);

      configure({ ARCA_MODE: "produccion", ARCA_ALLOW_PRODUCTION: "true" });
      expect((await call("get", "", tenant.token)).body.available).toBe(true);
    });
  });

  describe("POST /verify", () => {
    it("sin punto de venta no llama a ARCA, no guarda nada y explica qué hacer", async () => {
      const tenant = await newTenant({ pointOfSale: false });

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true, platformCuit: PLATFORM_CUIT, status: "NOT_STARTED", message: "Creá primero tu punto de venta para poder verificar la conexión." });
      expect(wsfe.getNextVoucherNumber).not.toHaveBeenCalled();
      expect(await row(tenant.orgId)).toBeNull();
    });

    it("con un punto de venta inactivo tampoco verifica", async () => {
      const tenant = await newTenant();
      await prisma.pointOfSale.updateMany({ where: { organizationId: tenant.orgId }, data: { isActive: false } });

      const res = await call("post", "/verify", tenant.token);

      expect(res.body.message).toMatch(/punto de venta/);
      expect(wsfe.getNextVoucherNumber).not.toHaveBeenCalled();
    });

    it("OK: queda VERIFIED, ARCA se consulta en nombre del CUIT del cliente y se audita", async () => {
      const tenant = await newTenant();
      wsfe.getNextVoucherNumber.mockResolvedValue(8);

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ available: true, platformCuit: PLATFORM_CUIT, status: "VERIFIED" });
      expect(Date.parse(res.body.verifiedAt)).not.toBeNaN();
      expect(Date.parse(res.body.lastCheckedAt)).not.toBeNaN();
      expect(res.body.message).toBeUndefined();
      expect(wsfe.getNextVoucherNumber).toHaveBeenCalledWith({ representedTaxId: tenant.cuit, salesPoint: 1, voucherType: 11 });
      expect(await row(tenant.orgId)).toMatchObject({ status: "VERIFIED", environment: "HOMOLOGACION", verifiedCuit: tenant.cuit, lastError: null });
      expect(await audits(tenant.orgId)).toEqual(["arca_delegation.verified"]);

      const again = await call("get", "", tenant.token);
      expect(again.body).toMatchObject({ status: "VERIFIED", verifiedAt: res.body.verifiedAt });
    });

    it("todavía no delegó: es un resultado normal (200 FAILED) con el CUIT de la plataforma, y se audita", async () => {
      const tenant = await newTenant();
      notDelegated();

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ available: true, status: "FAILED", message: NOT_DELEGATED });
      expect(res.body.verifiedAt).toBeUndefined();
      expect(await row(tenant.orgId)).toMatchObject({ status: "FAILED", lastError: NOT_DELEGATED, verifiedAt: null });
      expect(await audits(tenant.orgId)).toEqual(["arca_delegation.failed"]);
      expect((await call("get", "", tenant.token)).body).toMatchObject({ status: "FAILED", message: NOT_DELEGATED });
    });

    it("después de delegar en ARCA, volver a verificar pasa de FAILED a VERIFIED y borra el error", async () => {
      const tenant = await newTenant();
      notDelegated();
      await call("post", "/verify", tenant.token);
      wsfe.getNextVoucherNumber.mockReset().mockResolvedValue(1);

      const res = await call("post", "/verify", tenant.token);

      expect(res.body.status).toBe("VERIFIED");
      expect(res.body.message).toBeUndefined();
      expect(await row(tenant.orgId)).toMatchObject({ status: "VERIFIED", lastError: null });
      expect(await audits(tenant.orgId)).toEqual(["arca_delegation.failed", "arca_delegation.verified"]);
    });

    it("una caída de ARCA o de la red responde 503 genérico, sin detalles, y no cambia el estado guardado", async () => {
      const tenant = await newTenant();
      wsfe.getNextVoucherNumber.mockResolvedValueOnce(1);
      await call("post", "/verify", tenant.token);
      wsfe.getNextVoucherNumber.mockRejectedValue(new Error("connect ECONNRESET 10.1.2.3:443 /Users/secreto/arca.pem"));

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "No pudimos comunicarnos con ARCA en este momento. Probá de nuevo más tarde." });
      expect(res.text).not.toMatch(/ECONNRESET|10\.1\.2\.3|secreto/);
      expect(logLines.join("\n")).toMatch(/ECONNRESET/);
      expect(await row(tenant.orgId)).toMatchObject({ status: "VERIFIED" });
      expect(await audits(tenant.orgId)).toEqual(["arca_delegation.verified"]);
    });

    it("un rechazo de autenticación que no es de relación (certificado de la plataforma sin permiso) tampoco se muestra como falta de delegación", async () => {
      const tenant = await newTenant();
      wsfe.getNextVoucherNumber.mockRejectedValue(new ArcaAuthenticationError("denegado", { reason: "unauthorized_computer", service: "wsfe", operation: "x" }));

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(503);
      expect(res.text).not.toContain(PLATFORM_CUIT);
    });

    it("no disponible: 409 con el texto estable y sin llamar a ARCA", async () => {
      configure({ ARCA_DELEGATION: undefined });
      const tenant = await newTenant();

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: UNAVAILABLE });
      expect(wsfe.getNextVoucherNumber).not.toHaveBeenCalled();
    });

    it("en producción guarda el ambiente; una delegación de homologación se ve como no iniciada en producción", async () => {
      const tenant = await newTenant();
      await call("post", "/verify", tenant.token);
      expect(await row(tenant.orgId)).toMatchObject({ environment: "HOMOLOGACION" });

      configure({ ARCA_MODE: "produccion", ARCA_ALLOW_PRODUCTION: "true" });
      expect((await call("get", "", tenant.token)).body).toEqual({ available: true, platformCuit: PLATFORM_CUIT, status: "NOT_STARTED" });

      await call("post", "/verify", tenant.token);
      expect(await row(tenant.orgId)).toMatchObject({ status: "VERIFIED", environment: "PRODUCCION" });
    });
  });


  describe("el CUIT de la organización cambia o la delegación se borra", () => {
    it("una fila verificada para otro CUIT no vale: el GET la ignora y no se factura con el certificado de la plataforma", async () => {
      const tenant = await newTenant();
      await call("post", "/verify", tenant.token);
      await prisma.arcaDelegation.update({ where: { organizationId: tenant.orgId }, data: { verifiedCuit: uniqueCuit("20") } });

      expect((await call("get", "", tenant.token)).body).toEqual({ available: true, platformCuit: PLATFORM_CUIT, status: "NOT_STARTED" });
      const { getFiscalProviderForOrganization } = await import("../arca/provider-for-organization.js");
      await expect(getFiscalProviderForOrganization(env as never, { id: tenant.orgId, cuit: tenant.cuit })).rejects.toMatchObject({ userMessage: expect.stringMatching(/Todavía no conectaste/) });
    });

    it("PATCH con otro CUIT borra la delegación y el cliente guardado: deja de emitir para el CUIT nuevo", async () => {
      const tenant = await newTenant();
      await call("post", "/verify", tenant.token);
      const { getFiscalProviderForOrganization } = await import("../arca/provider-for-organization.js");
      expect((await getFiscalProviderForOrganization(env as never, { id: tenant.orgId, cuit: tenant.cuit })).issuerCuit).toBe(tenant.cuit);
      const newCuit = uniqueCuit("27");

      const res = await request(app).patch("/api/organizations/me").set(as(tenant.token)).send({ cuit: newCuit });

      expect(res.status).toBe(200);
      expect(await row(tenant.orgId)).toBeNull();
      expect((await call("get", "", tenant.token)).body.status).toBe("NOT_STARTED");
      await expect(getFiscalProviderForOrganization(env as never, { id: tenant.orgId, cuit: newCuit })).rejects.toMatchObject({ userMessage: expect.stringMatching(/Todavía no conectaste/) });
    });

    it("PATCH sin cambiar el CUIT no toca la delegación", async () => {
      const tenant = await newTenant();
      await call("post", "/verify", tenant.token);

      const res = await request(app).patch("/api/organizations/me").set(as(tenant.token)).send({ tradeName: "Sur" });

      expect(res.status).toBe(200);
      expect((await row(tenant.orgId))?.status).toBe("VERIFIED");
    });

    it("si el CUIT cambia mientras ARCA contesta, la verificación se descarta sin escribir nada", async () => {
      const tenant = await newTenant();
      wsfe.getNextVoucherNumber.mockImplementation(async () => {
        await prisma.organization.update({ where: { id: tenant.orgId }, data: { cuit: uniqueCuit("27") } });
        return 1;
      });

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/cambiaron mientras se verificaba/);
      expect(await row(tenant.orgId)).toBeNull();
    });

    it("un DELETE que llega mientras ARCA contesta gana: la verificación lenta no resucita la delegación", async () => {
      const tenant = await newTenant();
      wsfe.getNextVoucherNumber.mockImplementation(async () => {
        expect((await call("delete", "", tenant.token)).status).toBe(204);
        return 1;
      });

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("NOT_STARTED");
      expect(await row(tenant.orgId)).toBeNull();
      expect(await audits(tenant.orgId)).toEqual(["arca_delegation.deleted"]);
    });

    it("verificar y borrar a la vez terminan en un estado coherente (ni error ni fila a medias)", async () => {
      const tenant = await newTenant();

      const [verify, del] = await Promise.all([call("post", "/verify", tenant.token), call("delete", "", tenant.token)]);

      expect([200]).toContain(verify.status);
      expect(del.status).toBe(204);
      const final = await row(tenant.orgId);
      expect(final === null || final.status === "VERIFIED").toBe(true);
    });
  });

  describe("el CUIT de la plataforma", () => {
    const registration = (cuit: string) => ({ cuit, legalName: "Plataforma", taxCondition: "MONOTRIBUTO", monotributoCategory: "B", activityStartDate: "2024-03-01", baseCurrency: "ARS" });
    const emailOf = async (userId: number) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email as string;
    const taken = "Ese CUIT ya está registrado en otra organización";

    it("no se puede registrar como organización: mismo error que un CUIT ocupado", async () => {
      const platform = uniqueCuit("30");
      configure({ ARCA_CUIT: platform });
      const { token } = await newUser();

      const res = await request(app).post("/api/organizations").set(as(token)).send(registration(platform));
      sentBodies.push(res.text);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe(taken);
    });

    it("tampoco cambiando el CUIT de una organización existente", async () => {
      const platform = uniqueCuit("30");
      configure({ ARCA_CUIT: platform });
      const tenant = await newTenant();

      const res = await request(app).patch("/api/organizations/me").set(as(tenant.token)).send({ cuit: platform });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe(taken);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: tenant.orgId } })).cuit).toBe(tenant.cuit);
    });

    it("sí lo puede registrar quien está en ARCA_PLATFORM_OWNER_EMAILS (sin distinguir mayúsculas)", async () => {
      const platform = uniqueCuit("30");
      const { token, userId } = await newUser();
      configure({ ARCA_CUIT: platform, ARCA_PLATFORM_OWNER_EMAILS: `otra@test.com, ${(await emailOf(userId)).toUpperCase()}` });

      const res = await request(app).post("/api/organizations").set(as(token)).send(registration(platform));

      expect(res.status).toBe(201);
      orgIds.push(res.body.id);
    });

    it("sin proveedor sdk ni modo delegado no hay certificado que proteger: el CUIT se registra como cualquier otro", async () => {
      const platform = uniqueCuit("30");
      configure({ ARCA_CUIT: platform, ARCA_PROVIDER: "simulated", ARCA_DELEGATION: undefined });
      const { token } = await newUser();

      const res = await request(app).post("/api/organizations").set(as(token)).send(registration(platform));

      expect(res.status).toBe(201);
      orgIds.push(res.body.id);
    });

    // La organización ya existía con ese CUIT (por ejemplo, antes de habilitar el modo delegado).
    async function platformTenant() {
      const tenant = await newTenant();
      const { csr, privateKeyPem } = await generateCsr({ legalName: "Plataforma", cuit: tenant.cuit });
      configure({ ARCA_CUIT: tenant.cuit, ARCA_CERT_PEM: await signCsr(csr, { cuit: tenant.cuit }), ARCA_KEY_PEM: privateKeyPem });
      return tenant;
    }

    it("verify no marca VERIFIED a una organización con el CUIT de la plataforma si su usuario no está en la lista", async () => {
      const tenant = await platformTenant();

      const res = await call("post", "/verify", tenant.token);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: UNAVAILABLE });
      expect(await row(tenant.orgId)).toBeNull();
      expect(wsfe.getNextVoucherNumber).not.toHaveBeenCalled();
    });

    it("con el usuario en la lista, verify sigue funcionando", async () => {
      const tenant = await platformTenant();
      configure({ ARCA_PLATFORM_OWNER_EMAILS: await emailOf(tenant.userId), ARCA_CUIT: env.ARCA_CUIT, ARCA_CERT_PEM: env.ARCA_CERT_PEM, ARCA_KEY_PEM: env.ARCA_KEY_PEM });

      expect((await call("post", "/verify", tenant.token)).body.status).toBe("VERIFIED");
    });

    it("en producción el camino de variables con el mismo CUIT exige estar en la lista", async () => {
      const tenant = await platformTenant();
      const { getFiscalProviderForOrganization } = await import("../arca/provider-for-organization.js");
      const org = { id: tenant.orgId, cuit: tenant.cuit };

      env.NODE_ENV = "production";
      await expect(getFiscalProviderForOrganization(env as never, org)).rejects.toMatchObject({ userMessage: expect.stringMatching(/Todavía no conectaste/) });

      env.ARCA_PLATFORM_OWNER_EMAILS = await emailOf(tenant.userId);
      expect((await getFiscalProviderForOrganization(env as never, org)).issuerCuit).toBe(tenant.cuit);

      env.NODE_ENV = "test";
      env.ARCA_PLATFORM_OWNER_EMAILS = undefined;
      expect((await getFiscalProviderForOrganization(env as never, org)).issuerCuit).toBe(tenant.cuit);
    });
  });

  describe("límites de pedidos de verify", () => {
    it("una segunda verificación de la misma organización antes de 15 s responde 429; otra organización no se ve afectada", async () => {
      const a = await newTenant();
      const b = await newTenant();
      expect((await call("post", "/verify", a.token, true)).status).toBe(200);

      const second = await call("post", "/verify", a.token, true);

      expect(second.status).toBe(429);
      expect(second.body).toEqual({ error: "Esperá unos segundos antes de volver a verificar." });
      expect((await call("post", "/verify", b.token, true)).status).toBe(200);
    });

    it("más de 3 verificaciones simultáneas contra ARCA: la cuarta responde 429 y al liberarse vuelve a andar", async () => {
      const tenants = [await newTenant(), await newTenant(), await newTenant(), await newTenant()];
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow = { name: "doble", getLastAuthorized: async () => (await gate, { voucherNumber: 0 }), requestCae: vi.fn(), healthCheck: vi.fn() } as never;
      const run = (t: Tenant) => verifyArcaDelegation(t.userId, env as never, { buildProvider: () => slow });

      const first = tenants.slice(0, 3).map((t) => run(t));
      await vi.waitFor(() => expect(first).toHaveLength(3));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const fourth = await run(tenants[3]!).catch((error: unknown) => error);

      expect(fourth).toMatchObject({ statusCode: 429 });
      release();
      expect((await Promise.all(first)).map((v) => v.status)).toEqual(["VERIFIED", "VERIFIED", "VERIFIED"]);
      resetVerifyLimits();
      expect((await run(tenants[3]!)).status).toBe("VERIFIED");
    });
  });

  describe("DELETE", () => {
    it("borra la delegación, es idempotente y deja registro", async () => {
      const tenant = await newTenant();
      await call("post", "/verify", tenant.token);

      const first = await call("delete", "", tenant.token);
      const second = await call("delete", "", tenant.token);

      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      expect(await row(tenant.orgId)).toBeNull();
      expect((await call("get", "", tenant.token)).body.status).toBe("NOT_STARTED");
      expect(await audits(tenant.orgId)).toEqual(["arca_delegation.verified", "arca_delegation.deleted", "arca_delegation.deleted"]);
    });

    it("después de borrar, el cliente guardado no se sigue usando: facturar vuelve a pedir conectar ARCA", async () => {
      const tenant = await newTenant();
      await call("post", "/verify", tenant.token);
      const { getFiscalProviderForOrganization } = await import("../arca/provider-for-organization.js");
      const before = await getFiscalProviderForOrganization(env as never, { id: tenant.orgId, cuit: tenant.cuit });
      expect(before.issuerCuit).toBe(tenant.cuit);

      await call("delete", "", tenant.token);

      await expect(getFiscalProviderForOrganization(env as never, { id: tenant.orgId, cuit: tenant.cuit })).rejects.toMatchObject({ userMessage: expect.stringMatching(/Todavía no conectaste tu cuenta con ARCA/) });
    });
  });

  describe("aislamiento entre organizaciones", () => {
    it("la delegación de una no se ve ni se borra desde otra", async () => {
      const a = await newTenant();
      const b = await newTenant();
      await call("post", "/verify", a.token);

      expect((await call("get", "", b.token)).body.status).toBe("NOT_STARTED");
      expect((await call("delete", "", b.token)).status).toBe(204);
      expect((await call("get", "", a.token)).body.status).toBe("VERIFIED");
      expect(await row(b.orgId)).toBeNull();
    });

    it("la delegación verificada de una organización no habilita a otra a usar el certificado de la plataforma", async () => {
      const a = await newTenant();
      const b = await newTenant();
      await call("post", "/verify", a.token);
      const { getFiscalProviderForOrganization } = await import("../arca/provider-for-organization.js");

      const provider = await getFiscalProviderForOrganization(env as never, { id: a.orgId, cuit: a.cuit });
      expect(provider.issuerCuit).toBe(a.cuit);
      await expect(getFiscalProviderForOrganization(env as never, { id: b.orgId, cuit: b.cuit })).rejects.toMatchObject({ userMessage: expect.stringMatching(/Todavía no conectaste/) });
    });
  });

  describe("facturar de punta a punta con delegación", () => {
    async function draftInvoice(tenant: Tenant) {
      await prisma.organization.update({ where: { id: tenant.orgId }, data: { grossIncomeNumber: "901-123456-7" } });
      const pos = await prisma.pointOfSale.findFirstOrThrow({ where: { organizationId: tenant.orgId } });
      const invoice = await prisma.invoice.create({
        data: {
          organizationId: tenant.orgId,
          pointOfSaleId: pos.id,
          voucherType: "FACTURA_C",
          concept: "PRODUCTOS",
          issueDate: new Date("2026-11-16"),
          currency: "ARS",
          totalAmount: 1000,
          status: "DRAFT",
          items: { create: [{ description: "Pan", quantity: 1, unitPrice: 1000, subtotal: 1000 }] },
        },
      });
      return invoice.id as number;
    }
    const authorize = (tenant: Tenant, id: number) => request(app).post(`/api/invoices/${id}/authorize`).set(as(tenant.token)).send({});

    it("autoriza con el certificado de la plataforma: el emisor es el CUIT del cliente y el CUIT representado llega al pedido de CAE", async () => {
      const tenant = await newTenant();
      await call("post", "/verify", tenant.token);
      wsfe.getNextVoucherNumber.mockResolvedValue(5);
      wsfe.issue.mockResolvedValue({ kind: "authorized", cae: "75000000000001", caeExpiry: "20261201", observations: [], errors: [] });
      const id = await draftInvoice(tenant);

      const res = await authorize(tenant, id);
      sentBodies.push(res.text);

      expect(res.status).toBe(200);
      expect(res.body.fiscal.outcome).toBe("AUTHORIZED");
      expect(res.body.invoice.status).toBe("AUTHORIZED");
      expect(res.body.invoice.issuer.cuit).toBe(tenant.cuit);
      expect(res.body.invoice.issuer.cuit).not.toBe(PLATFORM_CUIT);
      expect(wsfe.issue).toHaveBeenCalledTimes(1);
      expect(wsfe.issue.mock.calls[0]![0]).toMatchObject({ representedTaxId: tenant.cuit, voucherNumber: 5 });
      const stored = await prisma.invoice.findUniqueOrThrow({ where: { id } });
      expect(stored).toMatchObject({ status: "AUTHORIZED", issuerCuit: tenant.cuit, cae: "75000000000001" });
    });

    it("sin delegación verificada no se factura con el certificado de la plataforma: 503 y la factura sigue en borrador", async () => {
      const tenant = await newTenant();
      const id = await draftInvoice(tenant);

      const res = await authorize(tenant, id);
      sentBodies.push(res.text);

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Todavía no conectaste tu cuenta con ARCA/);
      expect(wsfe.issue).not.toHaveBeenCalled();
      expect(wsfe.getNextVoucherNumber).not.toHaveBeenCalled();
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
    });
  });
});
