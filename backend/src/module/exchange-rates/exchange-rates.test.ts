import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { getUsdExchangeRateQuerySchema } from "./exchange-rates.schemas.js";
import { getUsdExchangeRate, clearNegativeCache } from "./exchange-rates.service.js";
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
    $transaction: vi.fn((ops) => Promise.all(ops)),
  },
}));

describe("exchange-rates module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    clearNegativeCache();
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

    it("rechaza fechas inexistentes en el calendario (ej: 2026-02-31)", () => {
      const result = getUsdExchangeRateQuerySchema.safeParse({ date: "2026-02-31" });
      expect(result.success).toBe(false);
    });
  });

  describe("getUsdExchangeRate service", () => {
    it("prioriza la serie ESTADISTICAS_CAMBIARIAS sobre COM_A_3500 en la caché", async () => {
      (vi.mocked(prisma.exchangeRate.findFirst) as any).mockImplementation(async (args: any) => {
        if (args?.where?.rateType === "ESTADISTICAS_CAMBIARIAS") {
          return {
            id: 1,
            source: "BCRA",
            rateType: "ESTADISTICAS_CAMBIARIAS",
            fromCurrency: "USD",
            toCurrency: "ARS",
            value: new Prisma.Decimal("1520.000000"),
            observedAt: new Date("2026-10-13T00:00:00.000Z"),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        if (args?.where?.rateType === "COM_A_3500") {
          return {
            id: 2,
            source: "BCRA",
            rateType: "COM_A_3500",
            fromCurrency: "USD",
            toCurrency: "ARS",
            value: new Prisma.Decimal("1510.000000"),
            observedAt: new Date("2026-10-13T00:00:00.000Z"),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      });

      const result = await getUsdExchangeRate("2026-10-13");

      expect(result.rateType).toBe("ESTADISTICAS_CAMBIARIAS");
      expect(result.value).toBe("1520.000000");
    });

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

    it("consulta la API del BCRA, persiste en DB en una sola transacción y resuelve la cotización", async () => {
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null);
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
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("resuelve el último día hábil anterior si se consulta un fin de semana", async () => {
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.exchangeRate.upsert).mockResolvedValue({} as any);

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
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.exchangeRate.upsert).mockResolvedValue({} as any);

      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      );

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

    it("aplica negative caching si una fecha vuelve vacía para no saturar al BCRA", async () => {
      (vi.mocked(prisma.exchangeRate.findFirst) as any).mockImplementation(async (args: any) => {
        // En fallback de DB simulamos que hay cotización de ayer
        if (args?.where?.observedAt?.lte) {
          return {
            id: 10,
            source: "BCRA",
            rateType: "ESTADISTICAS_CAMBIARIAS",
            fromCurrency: "USD",
            toCurrency: "ARS",
            value: new Prisma.Decimal("1500.000000"),
            observedAt: new Date("2026-10-12T00:00:00.000Z"),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch");
      // Primera vez: USD devuelve array vacío, REF devuelve array vacío
      fetchSpy.mockImplementation(
        async () =>
          new Response(JSON.stringify({ status: 200, results: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );

      const result1 = await getUsdExchangeRate("2026-10-13");
      expect(result1.value).toBe("1500.000000");
      expect(fetchSpy).toHaveBeenCalledTimes(2); // 1 USD + 1 REF

      // Segunda vez inmediata para la misma fecha: el negative cache debe evitar los fetch
      fetchSpy.mockClear();
      const result2 = await getUsdExchangeRate("2026-10-13");
      expect(result2.value).toBe("1500.000000");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("aplica fallback al último registro en DB si tanto USD como REF fallan y está dentro de los 30 días", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection error"));

      (vi.mocked(prisma.exchangeRate.findFirst) as any).mockImplementation(async (args: any) => {
        if (args?.where?.observedAt?.lte) {
          return {
            id: 2,
            source: "BCRA",
            rateType: "ESTADISTICAS_CAMBIARIAS",
            fromCurrency: "USD",
            toCurrency: "ARS",
            value: new Prisma.Decimal("1510.000000"),
            observedAt: new Date("2026-10-12T00:00:00.000Z"),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
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

    it("descarta cotizaciones cacheadas en DB con más de 30 días de antigüedad y lanza 503", async () => {
      vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null);
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));

      await expect(getUsdExchangeRate("2026-10-13")).rejects.toMatchObject({
        statusCode: 503,
      });

      // Verifica que findFirst haya incluido el filtro gte para el límite de antigüedad
      expect(prisma.exchangeRate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            observedAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
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
