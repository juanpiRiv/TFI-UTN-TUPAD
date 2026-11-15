/**
 * Casos límite de la carga de credenciales de ARCA (solicitud de certificado y subida del certificado), contra la
 * base real y por HTTP. Complementa arca-credential.test.ts y arca-credential-csr.test.ts, que usan la base simulada.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pkcs10CertificateRequest } from "@peculiar/x509";
import { uniqueCuit } from "../../test-utils/unique-cuit.js";
import { signCsr, signCsrWithCa } from "../../test-utils/arca-fixtures.js";

const KEY_HEX = vi.hoisted(() => "b".repeat(64));
vi.hoisted(() => {
  process.env.ARCA_ENCRYPTION_KEY = "b".repeat(64);
  process.env.ARCA_PROVIDER ??= "simulated";
});

let app: any;
let prisma: any;
let env: { ARCA_ENCRYPTION_KEY: string | undefined };
let dbAvailable = false;

if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
  try {
    prisma = (await import("../../lib/prisma.js")).prisma;
    await prisma.$queryRaw`SELECT 1`;
    app = (await import("../../app.js")).app;
    env = (await import("../../config/env.js")).env as never;
    dbAvailable = true;
  } catch {
    console.warn("PostgreSQL no disponible para los tests de borde de credenciales de ARCA");
  }
}

const { sanitizeOrganizationName, generateCsr } = await import("../arca/arca-csr.service.js");
const { decryptSecret, parseEncryptionKey } = await import("../arca/secret-box.js");
const { aadFor, csrAadFor } = await import("../arca/arca-credential.service.js");

const route = "/api/organizations/me/arca-credential";
const stamp = Date.now();
const PRIVATE_KEY_MARK = "PRIVATE KEY";

describe("sanitizeOrganizationName (casos límite)", () => {
  it.each([
    ["tildes y eñes", "Ñandú Pérez Hnos", "Nandu Perez Hnos"],
    ["comillas y barras", `La "Esquina" \\ del 'Sur'`, "La Esquina del 'Sur'"],
    ["coma, más, igual", "Evil, CN=admin+O=x", "Evil CN admin O x"],
    ["emoji", "Panadería 🥖 Sur", "Panaderia Sur"],
    ["solo emoji", "🥖🥖", "Contribuyente"],
    ["solo espacios", "     ", "Contribuyente"],
    ["vacío", "", "Contribuyente"],
    ["saltos de línea y tabulaciones", "A\r\nB\tC", "A B C"],
    ["carácter nulo", "A\u0000B", "A B"],
    ["texto bidireccional", "A\u202EB", "A B"],
    ["ideogramas", "株式会社", "Contribuyente"],
  ])("%s", (_name, input, expected) => {
    expect(sanitizeOrganizationName(input)).toBe(expected);
  });

  it("recorta a 64 sin dejar un espacio al final, ni siquiera si el corte cae en un espacio", () => {
    const out = sanitizeOrganizationName(`${"a".repeat(63)} ${"b".repeat(50)}`);
    expect(out).toBe("a".repeat(63));
    expect(sanitizeOrganizationName("x".repeat(500))).toHaveLength(64);
  });

  it("nunca devuelve caracteres que separen o escapen atributos del DN", () => {
    const hostile = `a,b+c=d"e\\f<g>h#i;j\n\r\t\u0000\u202E🥖Ñ`;
    expect(sanitizeOrganizationName(hostile)).toMatch(/^[A-Za-z0-9 .&'()-]+$/);
  });
});

describe.skipIf(!dbAvailable)("Credencial de ARCA: casos límite (base real, HTTP)", () => {
  const sentBodies: string[] = [];
  const logLines: string[] = [];
  const userIds: number[] = [];
  const orgIds: number[] = [];
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  interface Tenant {
    token: string;
    userId: number;
    orgId: number;
    cuit: string;
  }

  const spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeAll(() => {
    for (const method of ["error", "warn", "log"] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logLines.push(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}\n${arg.stack}` : String(arg))).join(" "))));
    }
  });

  afterEach(() => {
    env.ARCA_ENCRYPTION_KEY = KEY_HEX;
  });

  afterAll(async () => {
    spies.forEach((spy) => spy.mockRestore());
    // Ninguna respuesta ni ningún registro del servidor contiene una clave privada.
    for (const body of sentBodies) expect(body).not.toContain(PRIVATE_KEY_MARK);
    for (const line of logLines) expect(line).not.toContain(PRIVATE_KEY_MARK);
    if (!prisma) return;
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }] } });
    await prisma.arcaCsrRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.arcaCredential.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.pointOfSale.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.category.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function call(method: "get" | "post" | "delete", path: string, token?: string, body?: unknown) {
    let pending = request(app)[method](`${route}${path}`);
    if (token) pending = pending.set(as(token));
    if (body !== undefined) pending = pending.send(body as object);
    const res = await pending;
    sentBodies.push(res.text);
    return res;
  }

  let counter = 0;
  async function newUser(): Promise<{ token: string; userId: number }> {
    const email = `arca-edge-${stamp}-${counter++}@test.com`;
    const res = await request(app).post("/api/auth/register").send({ email, password: "password-1" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);
    return { token: res.body.token, userId: user.id };
  }

  async function newTenant(legalName = "Panadería Sur"): Promise<Tenant> {
    const { token, userId } = await newUser();
    const cuit = uniqueCuit("20");
    const res = await request(app).post("/api/organizations").set(as(token)).send({
      cuit,
      legalName,
      taxCondition: "MONOTRIBUTO",
      monotributoCategory: "B",
      activityStartDate: "2024-03-01",
      baseCurrency: "ARS",
    });
    expect(res.status).toBe(201);
    orgIds.push(res.body.id);
    return { token, userId, orgId: res.body.id, cuit };
  }

  const pendingRow = (orgId: number) => prisma.arcaCsrRequest.findUnique({ where: { organizationId: orgId } });
  const credentialRow = (orgId: number) => prisma.arcaCredential.findFirst({ where: { organizationId: orgId } });

  async function generate(tenant: Tenant): Promise<string> {
    const res = await call("post", "/csr", tenant.token);
    expect(res.status).toBe(201);
    return res.body.csr;
  }

  // Se comparten entre tests: un solo alta con certificado sirve de base para las variantes de formato.
  async function pendingWithCertificate(tenant: Tenant) {
    const csr = await generate(tenant);
    return { csr, ...(await signCsrWithCa(csr)) };
  }

  describe("razón social en el CSR", () => {
    const cases: Array<[string, string]> = [
      ["tildes", "Ñandú Pérez Hnos S.A."],
      ["comillas y barra invertida", `La "Esquina" \\ de 'Pepe'`],
      ["coma, más e igual (intento de inyectar atributos al DN)", "Evil, CN=admin+serialNumber=CUIT 30711111118"],
      ["emoji", "Panadería 🥖 del Sur"],
      ["más de 200 caracteres", "Razón ".repeat(40).trim()],
      ["solo espacios", "     "],
      ["solo emoji", "🥖🥖🥖"],
      ["con saltos de línea", "Línea uno\r\nLínea dos"],
    ];

    it.each(cases)("%s: el CSR es válido, el DN tiene exactamente los 4 atributos y no responde 500", async (_name, legalName) => {
      const tenant = await newTenant();
      await prisma.organization.update({ where: { id: tenant.orgId }, data: { legalName } });

      const res = await call("post", "/csr", tenant.token);

      expect(res.status).toBe(201);
      const parsed = new Pkcs10CertificateRequest(res.body.csr);
      expect(await parsed.verify()).toBe(true);
      const attributes = parsed.subjectName.toJSON();
      expect(attributes).toHaveLength(4);
      const keys = attributes.map((rdn: Record<string, string[]>) => Object.keys(rdn)[0]!);
      expect(keys.slice(0, 3)).toEqual(["C", "O", "CN"]);
      expect(["2.5.4.5", "serialNumber"]).toContain(keys[3]);
      const values = attributes.map((rdn: Record<string, string[]>) => Object.values(rdn)[0]![0]!);
      expect(values[0]).toBe("AR");
      expect(values[1]).toBe(sanitizeOrganizationName(legalName));
      expect(values[1]).not.toMatch(/[,+="\\<>#;\n\r]/);
      expect(values[1]!.length).toBeLessThanOrEqual(64);
      expect(values[1]!.length).toBeGreaterThan(0);
      expect(values[2]).toBe(`tfi${tenant.cuit}`);
      expect(values[3]).toBe(`CUIT ${tenant.cuit}`);
    });

    it("una razón social que contiene 'CUIT <11 dígitos>' no impide cargar el certificado que ARCA devuelve", async () => {
      const tenant = await newTenant();
      await prisma.organization.update({ where: { id: tenant.orgId }, data: { legalName: "Sucursal CUIT 30711111118 SRL" } });
      const csr = await generate(tenant);

      // ARCA copia el sujeto del pedido: la razón social figura en O y el CUIT real en serialNumber.
      const res = await call("post", "/certificate", tenant.token, { certificate: await signCsr(csr) });

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
    });
  });

  describe("generar la solicitud más de una vez", () => {
    it("dos seguidas dejan una sola fila y la última gana; un certificado del pedido viejo da 422", async () => {
      const tenant = await newTenant();
      const first = await generate(tenant);
      const second = await generate(tenant);

      expect(second).not.toBe(first);
      expect(await prisma.arcaCsrRequest.count({ where: { organizationId: tenant.orgId } })).toBe(1);
      expect((await pendingRow(tenant.orgId)).csr).toBe(second);

      const old = await call("post", "/certificate", tenant.token, { certificate: await signCsr(first) });
      expect(old.status).toBe(422);
      expect(old.body.error).toMatch(/no corresponde a este certificado/);
      expect(await credentialRow(tenant.orgId)).toBeNull();
      expect(await pendingRow(tenant.orgId)).not.toBeNull();

      const good = await call("post", "/certificate", tenant.token, { certificate: await signCsr(second) });
      expect(good.status).toBe(200);
    });

    it("cinco a la vez: todas responden 201, hay una sola fila y es de una de ellas, sin violación de unicidad", async () => {
      const tenant = await newTenant();

      const results = await Promise.all(Array.from({ length: 5 }, () => call("post", "/csr", tenant.token)));

      expect(results.map((res) => res.status)).toEqual([201, 201, 201, 201, 201]);
      expect(await prisma.arcaCsrRequest.count({ where: { organizationId: tenant.orgId } })).toBe(1);
      const stored = await pendingRow(tenant.orgId);
      expect(results.map((res) => res.body.csr)).toContain(stored.csr);
      // La clave guardada es la del CSR guardado (no se mezclan filas de distintos pedidos).
      const privateKey = decryptSecret(stored.privateKeyEncrypted, parseEncryptionKey(KEY_HEX), csrAadFor(tenant.orgId));
      const cert = await signCsr(stored.csr);
      expect((await call("post", "/certificate", tenant.token, { certificate: cert })).status).toBe(200);
      expect(privateKey).toContain(PRIVATE_KEY_MARK);
    });

    it("dos cargas del mismo certificado a la vez: ninguna responde 500 y la credencial queda única", async () => {
      const tenant = await newTenant();
      const csr = await generate(tenant);
      const certificate = await signCsr(csr);

      const results = await Promise.all([1, 2, 3].map(() => call("post", "/certificate", tenant.token, { certificate })));

      for (const res of results) expect([200, 422]).toContain(res.status);
      expect(results.some((res) => res.status === 200)).toBe(true);
      expect(await prisma.arcaCredential.count({ where: { organizationId: tenant.orgId } })).toBe(1);
      expect(await pendingRow(tenant.orgId)).toBeNull();
    });
  });

  describe("campo certificate", () => {
    it.each([
      ["vacío", { certificate: "" }],
      ["solo espacios", { certificate: "   \n\t  " }],
      ["número", { certificate: 12345 }],
      ["objeto", { certificate: { pem: "x" } }],
      ["arreglo", { certificate: ["-----BEGIN CERTIFICATE-----"] }],
      ["null", { certificate: null }],
      ["booleano", { certificate: true }],
      ["ausente", {}],
      ["con carácter nulo", { certificate: "-----BEGIN CERTIFICATE-----\u0000" }],
      ["más de 20.000 caracteres", { certificate: "A".repeat(20_001) }],
    ])("%s responde 400 y deja el pedido pendiente", async (_name, body) => {
      const tenant = await newTenant();
      await generate(tenant);

      const res = await call("post", "/certificate", tenant.token, body);

      expect(res.status).toBe(400);
      expect(await pendingRow(tenant.orgId)).not.toBeNull();
    });

    it("el cuerpo no es un objeto (arreglo, texto, JSON roto) responde 400, nunca 500", async () => {
      const tenant = await newTenant();
      await generate(tenant);

      expect((await call("post", "/certificate", tenant.token, [])).status).toBe(400);
      const broken = await request(app).post(`${route}/certificate`).set(as(tenant.token)).set("Content-Type", "application/json").send("{certificate:");
      expect(broken.status).toBe(400);
      const withoutBody = await request(app).post(`${route}/certificate`).set(as(tenant.token));
      expect(withoutBody.status).toBe(400);
    });

    it("un cuerpo de más de 100 KB se rechaza con 413 y no con 500, sin devolver lo pegado", async () => {
      const tenant = await newTenant();
      await generate(tenant);
      const huge = `-----BEGIN CERTIFICATE-----\n${"QUJD".repeat(60_000)}\n-----END CERTIFICATE-----`;

      const res = await call("post", "/certificate", tenant.token, { certificate: huge });

      expect(res.status).toBe(413);
      expect(res.text).not.toContain("QUJDQUJD");
      expect(await pendingRow(tenant.orgId)).not.toBeNull();
    });

    it("una clave privada pegada en el campo del certificado se rechaza y nunca se repite en la respuesta ni en los registros", async () => {
      const tenant = await newTenant();
      await generate(tenant);
      const { privateKeyPem } = await generateCsr({ legalName: "Otra", cuit: tenant.cuit });
      const secretLine = privateKeyPem.split("\n")[1]!;
      const before = logLines.length;

      const res = await call("post", "/certificate", tenant.token, { certificate: privateKeyPem });

      expect(res.status).toBe(422);
      expect(res.text).not.toContain(secretLine);
      expect(res.text).not.toContain(PRIVATE_KEY_MARK);
      expect(logLines.slice(before).join("\n")).not.toContain(secretLine);
      expect(await credentialRow(tenant.orgId)).toBeNull();
    });

    it("un CSR pegado en lugar del certificado se rechaza con 422", async () => {
      const tenant = await newTenant();
      const csr = await generate(tenant);

      const res = await call("post", "/certificate", tenant.token, { certificate: csr });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/certificado X\.509/);
    });

    it("basura con cabeceras válidas se rechaza con 422", async () => {
      const tenant = await newTenant();
      await generate(tenant);

      const res = await call("post", "/certificate", tenant.token, {
        certificate: "-----BEGIN CERTIFICATE-----\nZm9vYmFy\n-----END CERTIFICATE-----",
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/no es un certificado X\.509 válido/);
    });

    it("el certificado en base64 (DER) sin cabeceras se rechaza con 422", async () => {
      const tenant = await newTenant();
      const { certificate } = await pendingWithCertificate(tenant);
      const der = certificate.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");

      const res = await call("post", "/certificate", tenant.token, { certificate: der });

      expect(res.status).toBe(422);
      expect(await pendingRow(tenant.orgId)).not.toBeNull();
    });

    it("acepta saltos de línea CRLF", async () => {
      const tenant = await newTenant();
      const { certificate } = await pendingWithCertificate(tenant);

      const res = await call("post", "/certificate", tenant.token, { certificate: certificate.replace(/\n/g, "\r\n") });

      expect(res.status).toBe(200);
      expect((await credentialRow(tenant.orgId)).certificate).not.toContain("\r");
    });

    it("acepta líneas en blanco al principio y al final, y los saltos escritos como \\n", async () => {
      const tenant = await newTenant();
      const first = await pendingWithCertificate(tenant);
      expect((await call("post", "/certificate", tenant.token, { certificate: `\n\n  \n${first.certificate}\n\n\n` })).status).toBe(200);

      const second = await pendingWithCertificate(tenant);
      expect((await call("post", "/certificate", tenant.token, { certificate: second.certificate.replace(/\n/g, "\\n") })).status).toBe(200);
    });

    it("dos certificados encadenados con el propio primero se aceptan; con el de la CA primero se rechaza por no corresponder a la clave", async () => {
      const tenant = await newTenant();
      const { certificate, caCertificate } = await pendingWithCertificate(tenant);

      const caFirst = await call("post", "/certificate", tenant.token, { certificate: `${caCertificate}\n${certificate}` });
      expect(caFirst.status).toBe(422);
      expect(caFirst.body.error).toMatch(/no corresponde a este certificado/);
      expect(await pendingRow(tenant.orgId)).not.toBeNull();

      const leafFirst = await call("post", "/certificate", tenant.token, { certificate: `${certificate}\n${caCertificate}` });
      expect(leafFirst.status).toBe(200);
      expect(Number.isNaN(Date.parse(leafFirst.body.certificateExpiresAt))).toBe(false);
    });
  });

  describe("vigencia y contenido del certificado", () => {
    it("vencido, todavía no vigente y de otro CUIT dan 422 y el pedido sigue pendiente", async () => {
      const tenant = await newTenant();
      const csr = await generate(tenant);
      const day = 86_400_000;

      const expired = await call("post", "/certificate", tenant.token, {
        certificate: await signCsr(csr, { notBefore: new Date(Date.now() - 20 * day), notAfter: new Date(Date.now() - day) }),
      });
      const future = await call("post", "/certificate", tenant.token, {
        certificate: await signCsr(csr, { notBefore: new Date(Date.now() + day), notAfter: new Date(Date.now() + 30 * day) }),
      });
      const otherCuit = await call("post", "/certificate", tenant.token, { certificate: await signCsr(csr, { cuit: uniqueCuit("30") }) });

      expect(expired.status).toBe(422);
      expect(expired.body.error).toMatch(/vencido/);
      expect(future.status).toBe(422);
      expect(future.body.error).toMatch(/todavía no está vigente/);
      expect(otherCuit.status).toBe(422);
      expect(otherCuit.body.error).toMatch(/CUIT del certificado no es el de la organización/);
      expect(await pendingRow(tenant.orgId)).not.toBeNull();
      expect(await credentialRow(tenant.orgId)).toBeNull();
    });

    it("un certificado sin CUIT en el sujeto se acepta (comportamiento actual: solo se compara el CUIT si el certificado lo trae)", async () => {
      const tenant = await newTenant();
      const csr = await generate(tenant);

      const res = await call("post", "/certificate", tenant.token, { certificate: await signCsr(csr, { cuit: null }) });

      expect(res.status).toBe(200);
    });

    it("un certificado de otra clave da 422 y no se guarda nada", async () => {
      const tenant = await newTenant();
      await generate(tenant);
      const other = await generateCsr({ legalName: "Otra", cuit: tenant.cuit });

      const res = await call("post", "/certificate", tenant.token, { certificate: await signCsr(other.csr) });

      expect(res.status).toBe(422);
      expect(await credentialRow(tenant.orgId)).toBeNull();
    });
  });

  describe("estados", () => {
    it("subir dos veces: la segunda responde 422 porque ya no hay pedido pendiente", async () => {
      const tenant = await newTenant();
      const { certificate } = await pendingWithCertificate(tenant);

      expect((await call("post", "/certificate", tenant.token, { certificate })).status).toBe(200);
      const again = await call("post", "/certificate", tenant.token, { certificate });

      expect(again.status).toBe(422);
      expect(again.body.error).toBe("Primero generá la solicitud de certificado.");
    });

    it("con la clave de cifrado cambiada, el pedido pendiente no se puede leer: 422 claro, sin filtrar secretos, el pedido queda", async () => {
      const tenant = await newTenant();
      const { certificate } = await pendingWithCertificate(tenant);
      env.ARCA_ENCRYPTION_KEY = randomBytes(32).toString("hex");

      const res = await call("post", "/certificate", tenant.token, { certificate });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe("No se pudo leer la solicitud pendiente: generá una nueva.");
      expect(res.text).not.toContain(env.ARCA_ENCRYPTION_KEY);
      expect(await pendingRow(tenant.orgId)).not.toBeNull();
      // Generar una nueva con la clave actual lo arregla.
      const regenerated = await call("post", "/csr", tenant.token);
      expect(regenerated.status).toBe(201);
    });

    it("sin clave de cifrado en el servidor: 503 al generar y al subir, y el pedido pendiente no se toca", async () => {
      const tenant = await newTenant();
      const { certificate } = await pendingWithCertificate(tenant);
      const before = await pendingRow(tenant.orgId);
      env.ARCA_ENCRYPTION_KEY = undefined;

      const generate503 = await call("post", "/csr", tenant.token);
      const upload503 = await call("post", "/certificate", tenant.token, { certificate });

      expect(generate503.status).toBe(503);
      expect(upload503.status).toBe(503);
      expect((await pendingRow(tenant.orgId)).privateKeyEncrypted).toBe(before.privateKeyEncrypted);
      expect(generate503.text).not.toMatch(/[0-9a-f]{64}/);
    });

    it.each([["corta", "abcd"], ["no hexadecimal", "z".repeat(64)], ["de 63 caracteres", "a".repeat(63)], ["solo espacios", "   "]])(
      "una clave de cifrado %s en el servidor responde 503 sin repetir su valor",
      async (_name, bad) => {
        const tenant = await newTenant();
        env.ARCA_ENCRYPTION_KEY = bad;

        const res = await call("post", "/csr", tenant.token);

        expect(res.status).toBe(503);
        expect(res.body.error).not.toContain(bad.trim() || "\u0000");
        expect(await pendingRow(tenant.orgId)).toBeNull();
      },
    );

    it("DELETE es idempotente, responde 204 siempre y borra credencial y pedido pendiente", async () => {
      const tenant = await newTenant();
      expect((await call("delete", "", tenant.token)).status).toBe(204);

      await generate(tenant);
      expect((await call("delete", "", tenant.token)).status).toBe(204);
      expect(await pendingRow(tenant.orgId)).toBeNull();

      const { certificate } = await pendingWithCertificate(tenant);
      await call("post", "/certificate", tenant.token, { certificate });
      await generate(tenant);
      expect((await call("delete", "", tenant.token)).status).toBe(204);
      expect((await call("delete", "", tenant.token)).status).toBe(204);
      expect(await credentialRow(tenant.orgId)).toBeNull();
      expect((await call("get", "", tenant.token)).body).toEqual({ configured: false });
    });

    it("con la credencial ya configurada y un pedido nuevo, el GET muestra los dos y subir el certificado reemplaza la credencial", async () => {
      const tenant = await newTenant();
      const first = await pendingWithCertificate(tenant);
      await call("post", "/certificate", tenant.token, { certificate: first.certificate });
      const credentialBefore = await credentialRow(tenant.orgId);
      const second = await pendingWithCertificate(tenant);

      const both = await call("get", "", tenant.token);
      expect(both.body.configured).toBe(true);
      expect(both.body.pendingCsr.csr).toBe(second.csr);

      const replaced = await call("post", "/certificate", tenant.token, { certificate: second.certificate });
      expect(replaced.status).toBe(200);
      const credentialAfter = await credentialRow(tenant.orgId);
      expect(credentialAfter.certificate).not.toBe(credentialBefore.certificate);
      expect(credentialAfter.id).toBe(credentialBefore.id);
      expect(credentialAfter.token).toBeNull();
      expect((await call("get", "", tenant.token)).body.pendingCsr).toBeUndefined();
      // La clave guardada es la del pedido nuevo.
      const privateKey = decryptSecret(credentialAfter.privateKeyEncrypted, parseEncryptionKey(KEY_HEX), aadFor(tenant.orgId));
      expect(privateKey).toContain(PRIVATE_KEY_MARK);
    });

    it("un certificado rechazado no borra la credencial que ya funcionaba", async () => {
      const tenant = await newTenant();
      const first = await pendingWithCertificate(tenant);
      await call("post", "/certificate", tenant.token, { certificate: first.certificate });
      const before = await credentialRow(tenant.orgId);
      const csr = await generate(tenant);

      const res = await call("post", "/certificate", tenant.token, { certificate: await signCsr(csr, { notAfter: new Date(Date.now() - 1000), notBefore: new Date(Date.now() - 86_400_000) }) });

      expect(res.status).toBe(422);
      const after = await credentialRow(tenant.orgId);
      expect(after.certificate).toBe(before.certificate);
      expect(after.privateKeyEncrypted).toBe(before.privateKeyEncrypted);
    });
  });

  describe("aislamiento entre organizaciones y autenticación", () => {
    it("el usuario B no puede usar el pedido de A y su GET nunca muestra el de A", async () => {
      const a = await newTenant();
      const b = await newTenant();
      const csrA = await generate(a);
      const certificateA = await signCsr(csrA);

      const withoutPending = await call("post", "/certificate", b.token, { certificate: certificateA });
      expect(withoutPending.status).toBe(422);
      expect(withoutPending.body.error).toBe("Primero generá la solicitud de certificado.");

      const csrB = await generate(b);
      const withOwnPending = await call("post", "/certificate", b.token, { certificate: certificateA });
      expect(withOwnPending.status).toBe(422);
      expect(await credentialRow(b.orgId)).toBeNull();

      const getB = await call("get", "", b.token);
      expect(getB.body.pendingCsr.csr).toBe(csrB);
      expect(JSON.stringify(getB.body)).not.toContain(csrA);
      expect((await pendingRow(a.orgId)).csr).toBe(csrA);
      expect((await call("delete", "", b.token)).status).toBe(204);
      expect(await pendingRow(a.orgId)).not.toBeNull();
    });

    it("la clave del pedido de A no se descifra como si fuera de B (el dato asociado la ata a su organización)", async () => {
      const a = await newTenant();
      await generate(a);
      const row = await pendingRow(a.orgId);
      const key = parseEncryptionKey(KEY_HEX);

      expect(() => decryptSecret(row.privateKeyEncrypted, key, csrAadFor(a.orgId + 1))).toThrow();
      expect(() => decryptSecret(row.privateKeyEncrypted, key, aadFor(a.orgId))).toThrow();
    });

    it("sin token, con token inválido o sin esquema Bearer responde 401 en las cinco rutas", async () => {
      const calls: Array<[("get" | "post" | "delete"), string]> = [["get", ""], ["post", ""], ["post", "/csr"], ["post", "/certificate"], ["delete", ""]];
      for (const [method, path] of calls) {
        expect((await call(method, path)).status).toBe(401);
        expect((await call(method, path, "no-es-un-jwt")).status).toBe(401);
      }
      const basic = await request(app).get(route).set("Authorization", "Basic abc");
      expect(basic.status).toBe(401);
    });

    it("un usuario sin organización recibe 403 en las cinco rutas", async () => {
      const { token } = await newUser();
      const calls: Array<[("get" | "post" | "delete"), string, unknown?]> = [
        ["get", ""],
        ["post", "", { certificate: "x", privateKey: "y" }],
        ["post", "/csr"],
        ["post", "/certificate", { certificate: "x" }],
        ["delete", ""],
      ];
      for (const [method, path, body] of calls) {
        const res = await call(method, path, token, body);
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    });
  });

  describe("auditoría", () => {
    it("arca_csr.created, arca_credential.saved y arca_credential.deleted se registran sin secretos", async () => {
      const tenant = await newTenant();
      const { certificate, csr } = await pendingWithCertificate(tenant);
      await call("post", "/certificate", tenant.token, { certificate });
      await call("delete", "", tenant.token);

      const rows = await prisma.auditLog.findMany({ where: { organizationId: tenant.orgId, action: { startsWith: "arca_" } }, orderBy: { id: "asc" } });

      expect(rows.map((row: { action: string }) => row.action)).toEqual(["arca_csr.created", "arca_credential.saved", "arca_credential.deleted"]);
      for (const row of rows) {
        expect(row.userId).toBe(tenant.userId);
        expect(row.metadata).toBeNull();
        const serialized = JSON.stringify(row);
        expect(serialized).not.toContain(PRIVATE_KEY_MARK);
        expect(serialized).not.toContain("BEGIN");
        expect(serialized).not.toContain(csr.split("\n")[1]!);
        expect(serialized).not.toContain(certificate.split("\n")[1]!);
      }
      expect(rows[0].entity).toBe("ArcaCsrRequest");
      expect(rows[1].entity).toBe("ArcaCredential");
    });

    it("un pedido rechazado no deja auditoría de credencial guardada", async () => {
      const tenant = await newTenant();
      const csr = await generate(tenant);
      await call("post", "/certificate", tenant.token, { certificate: await signCsr(csr, { cuit: uniqueCuit("30") }) });

      const saved = await prisma.auditLog.count({ where: { organizationId: tenant.orgId, action: "arca_credential.saved" } });
      expect(saved).toBe(0);
    });
  });

  describe("proveedor fiscal de la organización (con la base real)", () => {
    const sdkEnv = (override: Record<string, string> = {}) => ({ ARCA_PROVIDER: "sdk", ARCA_MODE: "homologacion" as const, ARCA_ENCRYPTION_KEY: KEY_HEX, ...override });

    it("un certificado cargado por el endpoint nuevo hace que el proveedor se rearme: se evicta el cliente guardado en memoria", async () => {
      const { getFiscalProviderForOrganization, resetOrganizationProviders } = await import("../arca/provider-for-organization.js");
      const { getCachedProvider } = await import("../arca/provider-cache.js");
      const { loadArcaCredentialsForOrganization } = await import("../arca/arca-credential.service.js");
      const tenant = await newTenant();
      const org = { id: tenant.orgId, cuit: tenant.cuit };
      try {
        const first = await pendingWithCertificate(tenant);
        await call("post", "/certificate", tenant.token, { certificate: first.certificate });
        const providerA = await getFiscalProviderForOrganization(sdkEnv(), org);
        expect(await getFiscalProviderForOrganization(sdkEnv(), org)).toBe(providerA);
        const fingerprintA = (await loadArcaCredentialsForOrganization(org, KEY_HEX))!.fingerprint;
        expect(getCachedProvider(org.id, fingerprintA)).toBe(providerA);

        const second = await pendingWithCertificate(tenant);
        await call("post", "/certificate", tenant.token, { certificate: second.certificate });

        expect(getCachedProvider(org.id, fingerprintA)).toBeUndefined();
        const providerB = await getFiscalProviderForOrganization(sdkEnv(), org);
        expect(providerB).not.toBe(providerA);
        await call("delete", "", tenant.token);
        const fingerprintB = (await loadArcaCredentialsForOrganization(org, KEY_HEX)) as unknown;
        expect(fingerprintB).toBeNull();
      } finally {
        resetOrganizationProviders();
      }
    });

    it("una organización con pedido pendiente pero sin credencial recibe el 'todavía no cargó su credencial'", async () => {
      const { getFiscalProviderForOrganization, resetOrganizationProviders } = await import("../arca/provider-for-organization.js");
      const tenant = await newTenant();
      await generate(tenant);

      await expect(getFiscalProviderForOrganization(sdkEnv(), { id: tenant.orgId, cuit: tenant.cuit })).rejects.toThrow(/todavía no cargó su credencial/);
      resetOrganizationProviders();
    });

    it("la credencial de homologación cargada por el endpoint no se usa con el servidor en producción", async () => {
      const { getFiscalProviderForOrganization, resetOrganizationProviders } = await import("../arca/provider-for-organization.js");
      const tenant = await newTenant();
      const { certificate } = await pendingWithCertificate(tenant);
      await call("post", "/certificate", tenant.token, { certificate });

      await expect(
        getFiscalProviderForOrganization(sdkEnv({ ARCA_MODE: "produccion", ARCA_ALLOW_PRODUCTION: "true" }), { id: tenant.orgId, cuit: tenant.cuit }),
      ).rejects.toThrow(/credencial cargada es de homologación/);
      resetOrganizationProviders();
    });

    it("con la clave de cifrado del servidor cambiada, el proveedor falla con un mensaje seguro (no filtra la clave)", async () => {
      const { getFiscalProviderForOrganization, resetOrganizationProviders } = await import("../arca/provider-for-organization.js");
      const tenant = await newTenant();
      const { certificate } = await pendingWithCertificate(tenant);
      await call("post", "/certificate", tenant.token, { certificate });
      const otherKey = randomBytes(32).toString("hex");

      const error = await getFiscalProviderForOrganization(sdkEnv({ ARCA_ENCRYPTION_KEY: otherKey }), { id: tenant.orgId, cuit: tenant.cuit }).catch((e: unknown) => e);

      expect((error as Error).message).toMatch(/No se pudo descifrar/);
      expect((error as Error).message).not.toContain(otherKey);
      resetOrganizationProviders();
    });
  });
});
