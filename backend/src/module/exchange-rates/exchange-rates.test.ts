import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { getUsdExchangeRateQuerySchema } from "./exchange-rates.schemas.js";
import { getUsdExchangeRate } from "./exchange-rates.service.js";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { app } from "../../app.js";
import { env } from "../../config/env.js";

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 3000,
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-secret-at-least-32-characters-long!",
    CORS_ORIGIN: undefined,
  },
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    exchangeRate: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe("exchange-rates module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("getUsdExchangeRateQuerySchema", () => {
    it("valida una fecha correcta YYYY-MM-DD", () => {
      const result = getUsdExchangeRateQuerySchema.safeParse({
        date: "2026-10-13",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.date).toBe("2026-10-13");
      }
    });

    it("rechaza si falta el parámetro date", () => {
      const result = getUsdExchangeRateQuerySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rechaza formatos de fecha inválidos", () => {
      const invalid = ["13-10-2026", "2026/10/13", "not-a-date", "2026-1-1", ""];
      for (const d of invalid) {
        const result = getUsdExchangeRateQuerySchema.safeParse({ date: d });
        expect(result.success).toBe(false);
      }
    });
  });

  describe("getUsdExchangeRate service", () => {
    it("retorna la cotización cacheada en DB si existe coincidencia exacta", async () => {
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValueOnce({
        id: 1,
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
        fromCurrency: "USD",
        toCurrency: "ARS",
        value: new Prisma.Decimal("1512.500000"),
        observedAt: new Date("2026-10-13T00:00:00.000Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const globalFetch = vi.spyOn(globalThis, "fetch");

      const result = await getUsdExchangeRate("2026-10-13");

      expect(result).toEqual({
        date: "2026-10-13",
        observedAt: "2026-10-13",
        value: "1512.500000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });
      expect(globalFetch).not.toHaveBeenCalled();
    });

    it("consulta la API del BCRA, persiste en DB y resuelve la cotización si no estaba en cache", async () => {
      // 1. findFirst exact -> null
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValueOnce(null);
      // 2. upsert exitoso
      vi.mocked(prisma.exchangeRate.upsert).mockResolvedValue({} as any);

      const fakeBcraResponse = {
        status: 200,
        results: [
          {
            fecha: "2026-10-13",
            detalle: [
              {
                codigoMoneda: "USD",
                descripcion: "DOLAR E.E.U.U.",
                tipoPase: 0,
                tipoCotizacion: 1512.5,
              },
            ],
          },
          {
            fecha: "2026-10-09",
            detalle: [
              {
                codigoMoneda: "USD",
                descripcion: "DOLAR E.E.U.U.",
                tipoPase: 0,
                tipoCotizacion: 1517,
              },
            ],
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(fakeBcraResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await getUsdExchangeRate("2026-10-13");

      expect(result).toEqual({
        date: "2026-10-13",
        observedAt: "2026-10-13",
        value: "1512.500000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });

      expect(prisma.exchangeRate.upsert).toHaveBeenCalledTimes(2);
    });

    it("resuelve el último día hábil anterior si se consulta un fin de semana", async () => {
      // 1. findFirst exact -> null
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValueOnce(null);
      // 2. findFirst cached past -> null
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.exchangeRate.upsert).mockResolvedValue({} as any);

      // El domingo 11/10/2026 no hay cotización, la última hábil es el viernes 09/10/2026
      const fakeBcraResponse = {
        status: 200,
        results: [
          {
            fecha: "2026-10-09",
            detalle: [
              {
                codigoMoneda: "USD",
                descripcion: "DOLAR E.E.U.U.",
                tipoPase: 0,
                tipoCotizacion: 1517.0,
              },
            ],
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(fakeBcraResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await getUsdExchangeRate("2026-10-11");

      expect(result).toEqual({
        date: "2026-10-11",
        observedAt: "2026-10-09",
        value: "1517.000000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });
    });

    it("aplica fallback a la serie REF si la serie USD falla", async () => {
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.exchangeRate.upsert).mockResolvedValue({} as any);

      // USD falla con error 500
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      );

      // REF responde OK
      const fakeRefResponse = {
        status: 200,
        results: [
          {
            fecha: "2026-10-13",
            detalle: [
              {
                codigoMoneda: "REF",
                descripcion: "DOLAR REFERENCIA COM 3500",
                tipoPase: 0,
                tipoCotizacion: 1515.8543,
              },
            ],
          },
        ],
      };
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(fakeRefResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await getUsdExchangeRate("2026-10-13");

      expect(result).toEqual({
        date: "2026-10-13",
        observedAt: "2026-10-13",
        value: "1515.854300",
        source: "BCRA",
        rateType: "COM_A_3500",
      });
    });

    it("aplica fallback al último registro en DB si tanto USD como REF fallan", async () => {
      // 1. exactMatch -> null
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValueOnce(null);

      // USD y REF fallan a nivel red
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection error"));

      // Fallback en DB tiene el registro del día anterior
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValueOnce({
        id: 2,
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
        fromCurrency: "USD",
        toCurrency: "ARS",
        value: new Prisma.Decimal("1510.000000"),
        observedAt: new Date("2026-10-12T00:00:00.000Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await getUsdExchangeRate("2026-10-13");

      expect(result).toEqual({
        date: "2026-10-13",
        observedAt: "2026-10-12",
        value: "1510.000000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });
    });

    it("lanza error 503 controlado si la API falla y no hay ninguna cotización en DB", async () => {
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null);
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));

      await expect(getUsdExchangeRate("2026-10-13")).rejects.toMatchObject({
        statusCode: 503,
      });
    });
  });

  describe("GET /api/exchange-rates/usd route", () => {
    const validToken = jwt.sign({}, env.JWT_SECRET, {
      subject: "1",
      expiresIn: "1h",
    });

    it("rechaza peticiones sin autenticación (401)", async () => {
      const res = await request(app).get("/api/exchange-rates/usd?date=2026-10-13");
      expect(res.status).toBe(401);
    });

    it("rechaza peticiones con formato de fecha inválido (400)", async () => {
      const res = await request(app)
        .get("/api/exchange-rates/usd?date=invalid-date")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "date" }),
        ]),
      );
    });

    it("responde 200 con la cotización formateada", async () => {
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValueOnce({
        id: 1,
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
        fromCurrency: "USD",
        toCurrency: "ARS",
        value: new Prisma.Decimal("1512.500000"),
        observedAt: new Date("2026-10-13T00:00:00.000Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get("/api/exchange-rates/usd?date=2026-10-13")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        date: "2026-10-13",
        observedAt: "2026-10-13",
        value: "1512.500000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });
    });
  });
});

