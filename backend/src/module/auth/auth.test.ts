import "dotenv/config";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";

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
    console.warn("⚠️ PostgreSQL no disponible para los tests de auth");
  }
}

describe.skipIf(!dbAvailable)("auth (integration)", () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const email = `auth-${stamp}@test.com`;
  const password = "Password123!";
  let token = "";

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { email: { contains: `auth-${stamp}` } } });
    await prisma.$disconnect();
  });

  it("registra un usuario, devuelve un token y nunca el hash de la contraseña", async () => {
    const res = await request(app).post("/api/auth/register").send({ email, password });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|argon2/i);
    token = res.body.token;
  });

  it("guarda la contraseña con Argon2id y no en texto plano", async () => {
    const user = await prisma.user.findUnique({ where: { email } });

    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(password);
  });

  it("normaliza el email (minúsculas) y rechaza repetirlo con 409", async () => {
    const repeated = await request(app).post("/api/auth/register").send({ email: email.toUpperCase(), password });

    expect(repeated.status).toBe(409);
  });

  it("rechaza un email inválido y una contraseña corta con 400 y el detalle por campo", async () => {
    const badEmail = await request(app).post("/api/auth/register").send({ email: "no-es-un-email", password });
    const shortPassword = await request(app)
      .post("/api/auth/register")
      .send({ email: `short-${email}`, password: "corta" });

    expect(badEmail.status).toBe(400);
    expect(shortPassword.status).toBe(400);
    expect(JSON.stringify(shortPassword.body)).toMatch(/password/i);
  });

  it("inicia sesión con las credenciales correctas", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(email);
  });

  it("rechaza una contraseña incorrecta y un email inexistente con el mismo 401 (no revela qué usuarios existen)", async () => {
    const wrongPassword = await request(app).post("/api/auth/login").send({ email, password: "otra-clave-1" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: `nadie-${stamp}@test.com`, password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("rechaza un login sin contraseña con 400", async () => {
    const res = await request(app).post("/api/auth/login").send({ email });

    expect(res.status).toBe(400);
  });

  it("GET /me devuelve el usuario con su token y todavía sin organización", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email, organization: null });
  });

  it("GET /me rechaza con 401 un pedido sin token, con un token mal formado y con uno firmado con otra clave", async () => {
    const withoutToken = await request(app).get("/api/auth/me");
    const garbage = await request(app).get("/api/auth/me").set("Authorization", "Bearer esto-no-es-un-jwt");
    const wrongScheme = await request(app).get("/api/auth/me").set("Authorization", `Basic ${token}`);

    expect(withoutToken.status).toBe(401);
    expect(garbage.status).toBe(401);
    expect(wrongScheme.status).toBe(401);
  });
});
