import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "./error-handler.js";
import { AppError } from "../lib/error.js";

function run(error: unknown) {
  const res = { statusCode: 0, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  errorHandler(error, {} as never, res as never, (() => {}) as never);
  return res;
}

describe("errorHandler", () => {
  it("un AppError sin extra conserva su forma de siempre: error y details", () => {
    const res = run(new AppError(404, "Factura no encontrada"));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(JSON.stringify(res.body))).toEqual({ error: "Factura no encontrada" });
    const withDetails = run(new AppError(400, "invalid Data", [{ field: "cuit", message: "x" }]));
    expect(withDetails.body).toEqual({ error: "invalid Data", details: [{ field: "cuit", message: "x" }] });
  });

  it("los campos extra se agregan a la respuesta", () => {
    const res = run(new AppError(422, "Faltan datos", undefined, { code: "ISSUER_INCOMPLETE", missing: ["cuit"] }));
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ error: "Faltan datos", code: "ISSUER_INCOMPLETE", missing: ["cuit"] });
  });

  it("los extra no pueden pisar error ni details, y el estado sale solo de statusCode", () => {
    const res = run(new AppError(422, "mensaje real", [{ field: "a" }], { error: "otro", details: "otro", statusCode: 200, status: 200 }));
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ error: "mensaje real", details: [{ field: "a" }] });
  });

  it("un error cualquiera responde 500 genérico y no filtra el mensaje", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = run(new Error("password=hunter2 en la base"));
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Internal Server Error" });
  });

  it("un JSON roto responde 400 y uno de más de 100 KB responde 413", () => {
    expect(run({ type: "entity.parse.failed" })).toMatchObject({ statusCode: 400, body: { error: "invalid JSON" } });
    expect(run({ type: "entity.too.large", status: 413 })).toMatchObject({ statusCode: 413, body: { error: "Payload too large" } });
  });

  it("lo que no es un objeto (null, texto) también termina en 500 sin romper el handler", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(run(null).statusCode).toBe(500);
    expect(run("boom").statusCode).toBe(500);
    spy.mockRestore();
  });
});
