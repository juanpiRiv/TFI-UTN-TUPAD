import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

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
    arcaCsrRequest: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { decryptSecret, parseEncryptionKey } from "../arca/secret-box.js";
import { aadFor, loadArcaCredentialsForOrganization } from "../arca/arca-credential.service.js";
import { getCachedProvider, setCachedProvider } from "../arca/provider-cache.js";

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const directory = mkdtempSync(join(tmpdir(), "arca-credential-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function makeCredential(name: string, cuit: string) {
  const key = join(directory, `${name}.key`);
  const cert = join(directory, `${name}.crt`);
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "30", "-subj", `/CN=prueba/serialNumber=CUIT ${cuit}`],
    { stdio: "ignore" },
  );
  return { certificate: readFileSync(cert, "utf8"), privateKey: readFileSync(key, "utf8") };
}

describe.skipIf(!hasOpenssl())("Credencial de ARCA de la organización", () => {
  const userId = 10;
  const org = { id: 5, cuit: "20000000001" };
  const token = jwt.sign({}, env.JWT_SECRET, { subject: String(userId) });
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const valid = makeCredential("valida", org.cuit);
  const route = "/api/organizations/me/arca-credential";

  /** Fila que dejaría el upsert, para devolverla como lo haría la base. */
  let stored: { environment: string; certificate: string; privateKeyEncrypted: string; updatedAt: Date } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = null;
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(org as never);
    vi.mocked(prisma.arcaCredential.findUnique).mockImplementation((async () => stored) as never);
    vi.mocked(prisma.arcaCredential.upsert).mockImplementation((async ({ create }: { create: Record<string, unknown> }) => {
      stored = { environment: "HOMOLOGACION", certificate: create.certificate as string, privateKeyEncrypted: create.privateKeyEncrypted as string, updatedAt: new Date("2026-11-14T21:00:00.000Z") };
      return stored;
    }) as never);
    vi.mocked(prisma.arcaCredential.deleteMany).mockResolvedValue({ count: 1 } as never);
  });

  it("exige autenticación", async () => {
    expect((await request(app).get(route)).status).toBe(401);
    expect((await request(app).post(route).send(valid)).status).toBe(401);
    expect((await request(app).delete(route)).status).toBe(401);
  });

  it("sin credencial cargada informa configured false", async () => {
    const res = await request(app).get(route).set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  it("guarda la credencial: responde el estado y no devuelve ni el certificado ni la clave", async () => {
    const res = await request(app).post(route).set(auth()).send(valid);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, environment: "HOMOLOGACION", updatedAt: "2026-11-14T21:00:00.000Z" });
    expect(new Date(res.body.certificateExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|BEGIN|privateKey|certificate"/);
  });

  it("la clave se guarda cifrada y se puede descifrar con la clave del servidor y el id de la organización", async () => {
    await request(app).post(route).set(auth()).send(valid);

    const created = vi.mocked(prisma.arcaCredential.upsert).mock.calls[0]![0].create as { privateKeyEncrypted: string; organizationId: number };
    expect(created.organizationId).toBe(org.id);
    expect(created.privateKeyEncrypted).not.toContain("PRIVATE KEY");
    expect(decryptSecret(created.privateKeyEncrypted, parseEncryptionKey(ENCRYPTION_KEY), aadFor(org.id))).toBe(valid.privateKey.trim());
  });

  it("al reemplazar la credencial descarta el ticket de acceso anterior", async () => {
    await request(app).post(route).set(auth()).send(valid);

    expect(vi.mocked(prisma.arcaCredential.upsert).mock.calls[0]![0].update).toMatchObject({ token: null, sign: null, tokenExpiresAt: null });
  });

  it("después de guardar, GET informa configured true", async () => {
    await request(app).post(route).set(auth()).send(valid);
    const res = await request(app).get(route).set(auth());

    expect(res.body).toMatchObject({ configured: true, environment: "HOMOLOGACION" });
  });

  it("rechaza con 422 y un mensaje claro una clave que no es la del certificado", async () => {
    const res = await request(app).post(route).set(auth()).send({ certificate: valid.certificate, privateKey: makeCredential("otra", org.cuit).privateKey });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no corresponde a este certificado/);
    expect(prisma.arcaCredential.upsert).not.toHaveBeenCalled();
  });

  it("rechaza con 422 un certificado de otro CUIT", async () => {
    const res = await request(app).post(route).set(auth()).send(makeCredential("ajena", "30711111118"));

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/CUIT del certificado no es el de la organización/);
  });

  it("rechaza con 422 una clave cifrada con contraseña y con 400 un cuerpo incompleto", async () => {
    const encrypted = await request(app)
      .post(route)
      .set(auth())
      .send({ certificate: valid.certificate, privateKey: "-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----" });
    const incomplete = await request(app).post(route).set(auth()).send({ certificate: valid.certificate });

    expect(encrypted.status).toBe(422);
    expect(incomplete.status).toBe(400);
  });

  it("los errores nunca devuelven el contenido de la clave", async () => {
    const other = makeCredential("tercera", org.cuit);
    const res = await request(app).post(route).set(auth()).send({ certificate: valid.certificate, privateKey: other.privateKey });

    expect(JSON.stringify(res.body)).not.toContain(other.privateKey.split("\n")[1]!);
  });

  it("sin clave de cifrado en el servidor responde 503 y no guarda nada", async () => {
    const mutableEnv = env as { ARCA_ENCRYPTION_KEY: string | undefined };
    const original = mutableEnv.ARCA_ENCRYPTION_KEY;
    mutableEnv.ARCA_ENCRYPTION_KEY = undefined;
    try {
      const res = await request(app).post(route).set(auth()).send(valid);

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/no está disponible en este momento/);
      expect(prisma.arcaCredential.upsert).not.toHaveBeenCalled();
    } finally {
      mutableEnv.ARCA_ENCRYPTION_KEY = original;
    }
  });

  it("sin organización responde 403", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null as never);

    expect((await request(app).get(route).set(auth())).status).toBe(403);
  });

  it("guardar y borrar quedan en la auditoría, sin datos de la credencial", async () => {
    await request(app).post(route).set(auth()).send(valid);
    await request(app).delete(route).set(auth());

    const actions = vi.mocked(prisma.auditLog.create).mock.calls.map((call) => (call[0] as { data: { action: string } }).data.action);
    expect(actions).toEqual(["arca_credential.saved", "arca_credential.deleted"]);
    expect(JSON.stringify(vi.mocked(prisma.auditLog.create).mock.calls)).not.toMatch(/PRIVATE KEY|BEGIN/);
  });

  it("al reemplazar o borrar la credencial se olvida el cliente guardado en memoria, que tenía la clave", async () => {
    setCachedProvider(org.id, "huella-vieja", { name: "falso" } as never);
    setCachedProvider(99, "otra-org", { name: "otra" } as never);

    await request(app).post(route).set(auth()).send(valid);
    expect(getCachedProvider(org.id, "huella-vieja")).toBeUndefined();
    expect(getCachedProvider(99, "otra-org")).toBeDefined();

    setCachedProvider(org.id, "huella-nueva", { name: "falso" } as never);
    await request(app).delete(route).set(auth());
    expect(getCachedProvider(org.id, "huella-nueva")).toBeUndefined();
  });

  it("DELETE borra la credencial de la organización y responde 204", async () => {
    const res = await request(app).delete(route).set(auth());

    expect(res.status).toBe(204);
    expect(prisma.arcaCredential.deleteMany).toHaveBeenCalledWith({ where: { organizationId: org.id, environment: "HOMOLOGACION", service: "wsfe" } });
  });

  it("loadArcaCredentialsForOrganization devuelve las credenciales descifradas, con el CUIT de la organización", async () => {
    await request(app).post(route).set(auth()).send(valid);

    const loaded = await loadArcaCredentialsForOrganization(org, ENCRYPTION_KEY);

    expect(loaded?.credentials).toEqual({ cuit: org.cuit, certificatePem: valid.certificate.trim(), privateKeyPem: valid.privateKey.trim() });
    expect(loaded?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("loadArcaCredentialsForOrganization devuelve null sin credencial, y falla si la clave de cifrado es otra", async () => {
    expect(await loadArcaCredentialsForOrganization(org, ENCRYPTION_KEY)).toBeNull();

    await request(app).post(route).set(auth()).send(valid);
    await expect(loadArcaCredentialsForOrganization(org, randomBytes(32).toString("hex"))).rejects.toThrow(/No se pudo descifrar/);
  });
});
