import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// No hace falta base: el chequeo del token corre antes de cualquier consulta.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET ??= "test-secret-solo-para-tests-0000000";
});

import { app } from "./app.js";

type Method = "get" | "post" | "patch" | "put" | "delete";

// Todos los endpoints privados del backend (#66). Si se agrega uno nuevo, va acá.
const PRIVATE: [Method, string][] = [
  ["get", "/api/auth/me"],
  ["patch", "/api/users/me"],
  ["patch", "/api/users/me/password"],
  ["post", "/api/organizations"],
  ["get", "/api/organizations/me"],
  ["patch", "/api/organizations/me"],
  ["get", "/api/activities"],
  ["get", "/api/activities/1"],
  ["post", "/api/activities"],
  ["patch", "/api/activities/1"],
  ["get", "/api/points-of-sale"],
  ["get", "/api/points-of-sale/1"],
  ["post", "/api/points-of-sale"],
  ["patch", "/api/points-of-sale/1"],
  ["get", "/api/categories"],
  ["post", "/api/categories"],
  ["patch", "/api/categories/1"],
  ["get", "/api/clients"],
  ["get", "/api/clients/1"],
  ["post", "/api/clients"],
  ["patch", "/api/clients/1"],
  ["get", "/api/transactions"],
  ["post", "/api/transactions"],
  ["get", "/api/dashboard/summary"],
  ["get", "/api/exchange-rates/usd"],
  ["get", "/api/invoices"],
  ["get", "/api/invoices/1"],
  ["post", "/api/invoices"],
  ["post", "/api/invoices/1/authorize"],
  ["get", "/api/invoices/1/payments"],
  ["post", "/api/invoices/1/payments"],
];

describe("seguridad básica (Issue #66)", () => {
  it.each(PRIVATE)("%s %s exige un token", async (method, path) => {
    const withoutToken = await request(app)[method](path);
    const garbage = await request(app)[method](path).set("Authorization", "Bearer no-es-un-jwt");

    expect(withoutToken.status).toBe(401);
    expect(garbage.status).toBe(401);
  });

  it("los únicos endpoints sin token son el alta, el ingreso y el ping del servicio", async () => {
    // Responden algo distinto de 401 sin token (400 por cuerpo vacío o 200).
    expect((await request(app).post("/api/auth/register").send({})).status).toBe(400);
    expect((await request(app).post("/api/auth/login").send({})).status).toBe(400);
    expect((await request(app).get("/test")).status).toBe(200);
  });

  it("agrega los encabezados de seguridad de helmet y no expone el framework", async () => {
    const res = await request(app).get("/test");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("una ruta inexistente responde 404 sin filtrar detalles internos", async () => {
    const res = await request(app).get("/api/no-existe");

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/node_modules|at .*\.ts|stack/i);
  });
});
