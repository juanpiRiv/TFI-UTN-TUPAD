import { execFileSync } from "node:child_process";
import { createPublicKey, webcrypto, X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Pkcs10CertificateRequest, X509CertificateGenerator } from "@peculiar/x509";

const ENCRYPTION_KEY = vi.hoisted(() => "a".repeat(64));
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET ??= "test-secret-solo-para-tests-0000000";
  process.env.ARCA_PROVIDER ??= "simulated";
  process.env.ARCA_ENCRYPTION_KEY = "a".repeat(64);
});

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    arcaCredential: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    arcaCsrRequest: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { decryptSecret, parseEncryptionKey } from "../arca/secret-box.js";
import { aadFor, csrAadFor } from "../arca/arca-credential.service.js";
import { aliasFor, generateCsr, sanitizeOrganizationName } from "../arca/arca-csr.service.js";

const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const directory = mkdtempSync(join(tmpdir(), "arca-csr-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Firma el CSR con una CA descartable, como haría ARCA: el certificado lleva la clave pública del pedido. */
async function signCsr(csrPem: string, opts: { cuit?: string; notAfter?: Date; notBefore?: Date } = {}): Promise<string> {
  const csr = new Pkcs10CertificateRequest(csrPem);
  const ca = (await webcrypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign", "verify"])) as CryptoKeyPair;
  const now = Date.now();
  const cert = await X509CertificateGenerator.create({
    serialNumber: "01",
    subject: opts.cuit ? [{ C: ["AR"] }, { CN: ["prueba"] }, { "2.5.4.5": [`CUIT ${opts.cuit}`] }] : csr.subject,
    issuer: "CN=CA de prueba",
    notBefore: opts.notBefore ?? new Date(now - 3_600_000),
    notAfter: opts.notAfter ?? new Date(now + 30 * 86_400_000),
    signingAlgorithm: ALG,
    publicKey: csr.publicKey,
    signingKey: ca.privateKey,
  });
  return cert.toString("pem");
}

describe("generateCsr", () => {
  it("arma un CSR RSA-2048 con el sujeto que ARCA espera y la clave que le corresponde", async () => {
    const { csr, privateKeyPem } = await generateCsr({ legalName: "Panadería Ñandú, S.R.L.", cuit: "20000000001" });

    const parsed = new Pkcs10CertificateRequest(csr);
    expect(await parsed.verify()).toBe(true);
    expect(parsed.subject).toContain("C=AR");
    expect(parsed.subject).toContain("CN=tfi20000000001");
    expect(parsed.subject).toContain("2.5.4.5=CUIT 20000000001");
    expect(parsed.subject).toContain("O=Panaderia Nandu S.R.L.");
    expect((parsed.publicKey.algorithm as RsaHashedKeyAlgorithm).modulusLength).toBe(2048);
    expect(csr).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----/);
    expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    const derived = createPublicKey(privateKeyPem).export({ type: "spki", format: "der" });
    expect(Buffer.from(derived).equals(Buffer.from(parsed.publicKey.rawData))).toBe(true);
  });

  it.skipIf(!hasOpenssl())("openssl lee el CSR, verifica su firma y ve el CUIT en serialNumber", async () => {
    const { csr } = await generateCsr({ legalName: "Empresa", cuit: "20000000001" });
    const file = join(directory, "pedido.csr");
    writeFileSync(file, csr);

    const out = execFileSync("openssl", ["req", "-in", file, "-verify", "-noout", "-subject"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toMatch(/serialNumber\s*=\s*CUIT 20000000001/);
  });

  it("sanea la razón social sin dejarla vacía ni pasar separadores del DN", () => {
    expect(sanitizeOrganizationName('ACME, "Sur"+Norte=1\n<x>;#\\')).toBe("ACME Sur Norte 1 x");
    expect(sanitizeOrganizationName("日本")).toBe("Contribuyente");
    expect(sanitizeOrganizationName("x".repeat(100))).toHaveLength(64);
    expect(aliasFor("20-00000000-1")).toBe("tfi20000000001");
  });
});

describe("Solicitud de certificado de ARCA (CSR)", () => {
  const userId = 10;
  const org = { id: 5, cuit: "20000000001", legalName: "Panadería Sur" };
  const token = jwt.sign({}, env.JWT_SECRET, { subject: String(userId) });
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const route = "/api/organizations/me/arca-credential";
  const key = parseEncryptionKey(ENCRYPTION_KEY);

  let pending: { id: number; csr: string; privateKeyEncrypted: string; createdAt: Date } | null;
  let credential: { environment: string; certificate: string; privateKeyEncrypted: string; updatedAt: Date } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    pending = null;
    credential = null;
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(org as never);
    vi.mocked(prisma.arcaCsrRequest.findUnique).mockImplementation((async () => pending) as never);
    vi.mocked(prisma.arcaCsrRequest.upsert).mockImplementation((async ({ create }: { create: { csr: string; privateKeyEncrypted: string } }) => {
      pending = { id: 1, csr: create.csr, privateKeyEncrypted: create.privateKeyEncrypted, createdAt: new Date("2026-11-15T12:00:00.000Z") };
      return pending;
    }) as never);
    vi.mocked(prisma.arcaCsrRequest.deleteMany).mockImplementation((async () => {
      pending = null;
      return { count: 1 };
    }) as never);
    vi.mocked(prisma.arcaCredential.findUnique).mockImplementation((async () => credential) as never);
    vi.mocked(prisma.arcaCredential.upsert).mockImplementation((async ({ create }: { create: { certificate: string; privateKeyEncrypted: string } }) => {
      credential = { environment: "HOMOLOGACION", certificate: create.certificate, privateKeyEncrypted: create.privateKeyEncrypted, updatedAt: new Date("2026-11-15T12:30:00.000Z") };
      return { id: 3, ...credential };
    }) as never);
    vi.mocked(prisma.arcaCredential.deleteMany).mockResolvedValue({ count: 1 } as never);
  });

  it("exige autenticación", async () => {
    expect((await request(app).post(`${route}/csr`)).status).toBe(401);
    expect((await request(app).post(`${route}/certificate`).send({ certificate: "x" })).status).toBe(401);
  });

  it("genera el CSR: responde 201 con el pedido y nunca con la clave, que queda cifrada", async () => {
    const res = await request(app).post(`${route}/csr`).set(auth());

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "csr"]);
    expect(res.body.createdAt).toBe("2026-11-15T12:00:00.000Z");
    expect(res.body.csr).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----/);
    expect(JSON.stringify(res.body)).not.toContain("PRIVATE KEY");

    const stored = pending!;
    expect(stored.privateKeyEncrypted).not.toContain("PRIVATE KEY");
    const privateKey = decryptSecret(stored.privateKeyEncrypted, key, csrAadFor(org.id));
    const csr = new Pkcs10CertificateRequest(res.body.csr);
    expect(Buffer.from(createPublicKey(privateKey).export({ type: "spki", format: "der" })).equals(Buffer.from(csr.publicKey.rawData))).toBe(true);
    // El dato asociado es propio del pedido: no se descifra como si fuera una credencial.
    expect(() => decryptSecret(stored.privateKeyEncrypted, key, aadFor(org.id))).toThrow();
  });

  it("el GET informa el pedido pendiente, también si ya hay una credencial configurada", async () => {
    expect((await request(app).get(route).set(auth())).body).toEqual({ configured: false });

    await request(app).post(`${route}/csr`).set(auth());
    const res = await request(app).get(route).set(auth());

    expect(res.body.configured).toBe(false);
    expect(res.body.pendingCsr).toEqual({ csr: pending!.csr, createdAt: "2026-11-15T12:00:00.000Z" });
    expect(JSON.stringify(res.body)).not.toContain("PRIVATE KEY");
  });

  it("generar de nuevo reemplaza el pedido pendiente", async () => {
    const first = await request(app).post(`${route}/csr`).set(auth());
    const second = await request(app).post(`${route}/csr`).set(auth());

    expect(second.body.csr).not.toBe(first.body.csr);
    expect(pending!.csr).toBe(second.body.csr);
    expect(vi.mocked(prisma.arcaCsrRequest.upsert).mock.calls[1]![0].where).toEqual({ organizationId: org.id });
  });

  it("con el certificado que firma el CSR queda configurado, se borra el pedido y se audita", async () => {
    const { body } = await request(app).post(`${route}/csr`).set(auth());
    const certificate = await signCsr(body.csr);

    const res = await request(app).post(`${route}/certificate`).set(auth()).send({ certificate });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, environment: "HOMOLOGACION", updatedAt: "2026-11-15T12:30:00.000Z" });
    expect(res.body.pendingCsr).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|BEGIN/);
    expect(pending).toBeNull();
    // La clave queda guardada como una credencial más: cifrada y con el dato asociado de la credencial.
    const saved = vi.mocked(prisma.arcaCredential.upsert).mock.calls[0]![0].create as { privateKeyEncrypted: string; certificate: string };
    expect(saved.privateKeyEncrypted).not.toContain("PRIVATE KEY");
    const privateKey = decryptSecret(saved.privateKeyEncrypted, key, aadFor(org.id));
    expect(Buffer.from(createPublicKey(privateKey).export({ type: "spki", format: "der" })).equals(Buffer.from(new X509Certificate(saved.certificate).publicKey.export({ type: "spki", format: "der" })))).toBe(true);
    const actions = vi.mocked(prisma.auditLog.create).mock.calls.map((call) => (call[0] as { data: { action: string } }).data.action);
    expect(actions).toContain("arca_credential.saved");
  });

  it("sin solicitud pendiente responde 422", async () => {
    const other = await generateCsr({ legalName: "Otra", cuit: org.cuit });
    const res = await request(app).post(`${route}/certificate`).set(auth()).send({ certificate: await signCsr(other.csr) });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Primero generá la solicitud de certificado.");
    expect(prisma.arcaCredential.upsert).not.toHaveBeenCalled();
  });

  it("un certificado de otra clave se rechaza con 422 y el pedido sigue pendiente", async () => {
    await request(app).post(`${route}/csr`).set(auth());
    const other = await generateCsr({ legalName: "Otra", cuit: org.cuit });

    const res = await request(app).post(`${route}/certificate`).set(auth()).send({ certificate: await signCsr(other.csr) });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no corresponde a este certificado/);
    expect(pending).not.toBeNull();
    expect(prisma.arcaCredential.upsert).not.toHaveBeenCalled();
  });

  it("rechaza con 422 un certificado de otro CUIT o vencido", async () => {
    const { body } = await request(app).post(`${route}/csr`).set(auth());

    const wrongCuit = await request(app).post(`${route}/certificate`).set(auth()).send({ certificate: await signCsr(body.csr, { cuit: "30711111118" }) });
    const expired = await request(app)
      .post(`${route}/certificate`)
      .set(auth())
      .send({ certificate: await signCsr(body.csr, { notBefore: new Date(Date.now() - 20 * 86_400_000), notAfter: new Date(Date.now() - 86_400_000) }) });

    expect(wrongCuit.status).toBe(422);
    expect(wrongCuit.body.error).toMatch(/CUIT del certificado no es el de la organización/);
    expect(expired.status).toBe(422);
    expect(expired.body.error).toMatch(/vencido/);
    expect(pending).not.toBeNull();
  });

  it("rechaza con 400 un cuerpo sin certificado y con 422 un texto que no es un certificado", async () => {
    await request(app).post(`${route}/csr`).set(auth());

    expect((await request(app).post(`${route}/certificate`).set(auth()).send({})).status).toBe(400);
    expect((await request(app).post(`${route}/certificate`).set(auth()).send({ certificate: "hola" })).status).toBe(422);
  });

  it("sin clave de cifrado en el servidor responde 503 y no guarda nada", async () => {
    const mutableEnv = env as { ARCA_ENCRYPTION_KEY: string | undefined };
    const original = mutableEnv.ARCA_ENCRYPTION_KEY;
    mutableEnv.ARCA_ENCRYPTION_KEY = undefined;
    try {
      const csr = await request(app).post(`${route}/csr`).set(auth());
      const cert = await request(app).post(`${route}/certificate`).set(auth()).send({ certificate: "x" });

      expect(csr.status).toBe(503);
      expect(csr.body.error).toMatch(/no está disponible en este momento/);
      expect(cert.status).toBe(503);
      expect(prisma.arcaCsrRequest.upsert).not.toHaveBeenCalled();
    } finally {
      mutableEnv.ARCA_ENCRYPTION_KEY = original;
    }
  });

  it("DELETE borra también el pedido pendiente", async () => {
    await request(app).post(`${route}/csr`).set(auth());

    const res = await request(app).delete(route).set(auth());

    expect(res.status).toBe(204);
    expect(pending).toBeNull();
    expect(prisma.arcaCsrRequest.deleteMany).toHaveBeenCalledWith({ where: { organizationId: org.id } });
  });

  it("el camino directo con certificado y clave propios sigue funcionando", async () => {
    const { csr, privateKeyPem } = await generateCsr({ legalName: org.legalName, cuit: org.cuit });

    const res = await request(app).post(route).set(auth()).send({ certificate: await signCsr(csr), privateKey: privateKeyPem });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true });
  });
});
