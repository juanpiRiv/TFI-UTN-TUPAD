import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
} from "./transactions.schemas.js";
import { createTransaction, listTransactions } from "./transactions.service.js";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";

vi.mock("../../lib/prisma.js", () => {
  const mockPrisma: any = {
    organization: {
      findUnique: vi.fn(),
    },
    category: {
      findFirst: vi.fn(),
    },
    client: {
      findFirst: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) =>
      typeof cb === "function" ? cb(mockPrisma) : Promise.all(cb),
    ),
  };
  return { prisma: mockPrisma };
});

import { exchangeRatesService } from "../exchange-rates/exchange-rates.service.js";

describe("Transactions Schemas", () => {
  describe("createTransactionSchema", () => {
    it("validates valid income transaction in base currency ARS", () => {
      const input = {
        type: "INCOME",
        amount: "15000.50",
        currency: "ARS",
        categoryId: "1",
        transactionDate: "2026-10-13",
        description: "Pago de honorarios",
      };

      const result = createTransactionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.amount).toBe("15000.50");
        expect(result.data.categoryId).toBe(1);
        expect(result.data.type).toBe("INCOME");
        expect(result.data.currency).toBe("ARS");
      }
    });

    it("validates USD transaction with exchange rate", () => {
      const input = {
        type: "EXPENSE",
        amount: "120.00",
        currency: "USD",
        exchangeRate: "1420.500000",
        categoryId: 4,
        clientId: 2,
        transactionDate: "2026-10-13",
      };

      const result = createTransactionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exchangeRate).toBe("1420.500000");
        expect(result.data.clientId).toBe(2);
      }
    });

    it("rejects non-positive amount (amount <= 0)", () => {
      const zeroResult = createTransactionSchema.safeParse({
        type: "INCOME",
        amount: "0",
        currency: "ARS",
        categoryId: 1,
        transactionDate: "2026-10-13",
      });
      expect(zeroResult.success).toBe(false);

      const negativeResult = createTransactionSchema.safeParse({
        type: "INCOME",
        amount: "-50.00",
        currency: "ARS",
        categoryId: 1,
        transactionDate: "2026-10-13",
      });
      expect(negativeResult.success).toBe(false);
    });

    it("rejects amount with more than 2 decimal places", () => {
      const result = createTransactionSchema.safeParse({
        type: "INCOME",
        amount: "100.999",
        currency: "ARS",
        categoryId: 1,
        transactionDate: "2026-10-13",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid date format", () => {
      const result = createTransactionSchema.safeParse({
        type: "INCOME",
        amount: "100.00",
        currency: "ARS",
        categoryId: 1,
        transactionDate: "13/10/2026",
      });
      expect(result.success).toBe(false);
    });

    it("rejects out of bounds IDs", () => {
      const result = createTransactionSchema.safeParse({
        type: "INCOME",
        amount: "100.00",
        currency: "ARS",
        categoryId: 3000000000,
        transactionDate: "2026-10-13",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("listTransactionsQuerySchema (Filtros e historial - Issue #32)", () => {
    it("parses valid date range filters (from, to)", () => {
      const query = {
        from: "2026-10-01",
        to: "2026-10-31",
      };

      const result = listTransactionsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.from).toBe("2026-10-01");
        expect(result.data.to).toBe("2026-10-31");
      }
    });

    it("parses combined filters (type + categoryId)", () => {
      const query = {
        type: "EXPENSE",
        categoryId: "4",
      };

      const result = listTransactionsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("EXPENSE");
        expect(result.data.categoryId).toBe(4);
      }
    });

    it("parses combined filters with dates, type, category and client", () => {
      const query = {
        from: "2026-10-01",
        to: "2026-10-31",
        type: "INCOME",
        categoryId: "1",
        clientId: "2",
      };

      const result = listTransactionsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.from).toBe("2026-10-01");
        expect(result.data.to).toBe("2026-10-31");
        expect(result.data.type).toBe("INCOME");
        expect(result.data.categoryId).toBe(1);
        expect(result.data.clientId).toBe(2);
      }
    });

    it("rejects invalid date format in from", () => {
      const result = listTransactionsQuerySchema.safeParse({ from: "invalid-date" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid date format in to", () => {
      const result = listTransactionsQuerySchema.safeParse({ to: "13/10/2026" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid movement type", () => {
      const result = listTransactionsQuerySchema.safeParse({ type: "INVALID_TYPE" });
      expect(result.success).toBe(false);
    });

    it("rejects non-positive categoryId", () => {
      const result = listTransactionsQuerySchema.safeParse({ categoryId: "0" });
      expect(result.success).toBe(false);

      const negativeResult = listTransactionsQuerySchema.safeParse({ categoryId: "-5" });
      expect(negativeResult.success).toBe(false);
    });

    it("rejects categoryId exceeding int32 bounds", () => {
      const result = listTransactionsQuerySchema.safeParse({ categoryId: 3000000000 });
      expect(result.success).toBe(false);
    });
  });

  describe("createTransaction service - cotizaciones y multimoneda (Issue #37)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.restoreAllMocks();
      vi.spyOn(exchangeRatesService, "getUsdExchangeRate");
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: 1,
        baseCurrency: "ARS",
      } as any);

      vi.mocked(prisma.category.findFirst).mockResolvedValue({
        id: 1,
        organizationId: 1,
        name: "Honorarios",
        type: "INCOME",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      (prisma.transaction.create as any).mockImplementation(async ({ data }: any) => ({
        id: 10,
        organizationId: data.organizationId,
        paymentId: null,
        categoryId: data.categoryId,
        clientId: data.clientId ?? null,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate ?? null,
        transactionDate: data.transactionDate,
        description: data.description ?? null,
        voidedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        category: { id: 1, name: "Honorarios", type: "INCOME" },
        client: null,
      }));
    });

    it("guarda el tipo de cambio ingresado/editado a mano por el usuario (sobreescritura)", async () => {
      const input = {
        type: "INCOME" as const,
        amount: "100.00",
        currency: "USD" as const,
        exchangeRate: "1550.000000", // usuario ingresó valor propio
        categoryId: 1,
        transactionDate: "2026-10-13",
        description: null,
      };

      const result = await createTransaction(1, input);

      expect(result.currency).toBe("USD");
      expect(result.exchangeRate).toBe("1550");
      expect(exchangeRatesService.getUsdExchangeRate).not.toHaveBeenCalled();
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: "USD",
            exchangeRate: new Prisma.Decimal("1550.000000"),
          }),
        }),
      );
    });

    it("trae y guarda automáticamente la cotización del BCRA si no se envía exchangeRate", async () => {
      vi.mocked(exchangeRatesService.getUsdExchangeRate).mockResolvedValueOnce({
        date: "2026-10-13",
        observedAt: "2026-10-13",
        value: "1512.500000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });

      const input = {
        type: "INCOME" as const,
        amount: "250.00",
        currency: "USD" as const,
        categoryId: 1,
        transactionDate: "2026-10-13",
        description: null,
      };

      const result = await createTransaction(1, input);

      expect(exchangeRatesService.getUsdExchangeRate).toHaveBeenCalledWith("2026-10-13");
      expect(result.currency).toBe("USD");
      expect(result.exchangeRate).toBe("1512.5");
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: "USD",
            exchangeRate: new Prisma.Decimal("1512.500000"),
          }),
        }),
      );
    });

    it("guarda exchangeRate como null si el movimiento es en la moneda base (ARS)", async () => {
      const input = {
        type: "INCOME" as const,
        amount: "50000.00",
        currency: "ARS" as const,
        categoryId: 1,
        transactionDate: "2026-10-13",
        description: null,
      };

      const result = await createTransaction(1, input);

      expect(result.currency).toBe("ARS");
      expect(result.exchangeRate).toBeNull();
      expect(exchangeRatesService.getUsdExchangeRate).not.toHaveBeenCalled();
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: "ARS",
            exchangeRate: null,
          }),
        }),
      );
    });

    it("RN-06: crear o listar movimientos nunca modifica ni re-resuelve cotizaciones de movimientos existentes", async () => {
      // 1. Movimiento histórico con cotización fija 1450.00 ARS (sin campos inventados como isVoided o voidReason)
      const oldTransaction = {
        id: 1,
        organizationId: 1,
        paymentId: null,
        categoryId: 1,
        clientId: null,
        type: "INCOME" as const,
        amount: new Prisma.Decimal("100.00"),
        currency: "USD" as const,
        exchangeRate: new Prisma.Decimal("1450.000000"), // copia histórica inmutable
        transactionDate: new Date("2026-10-12T00:00:00.000Z"),
        description: "Cobro cliente ayer",
        voidedAt: null,
        createdAt: new Date("2026-10-12T10:00:00.000Z"),
        updatedAt: new Date("2026-10-12T10:00:00.000Z"),
        category: { id: 1, name: "Honorarios", type: "INCOME" },
        client: null,
      };

      // 2. Mock de cotización del BCRA que hoy sube a 1512.50
      vi.mocked(exchangeRatesService.getUsdExchangeRate).mockResolvedValueOnce({
        date: "2026-10-13",
        observedAt: "2026-10-13",
        value: "1512.500000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });

      const todayInput = {
        type: "INCOME" as const,
        amount: "100.00",
        currency: "USD" as const,
        categoryId: 1,
        transactionDate: "2026-10-13",
        description: null,
      };

      const todayTransaction = await createTransaction(1, todayInput);
      expect(todayTransaction.exchangeRate).toBe("1512.5");

      // Verificación clave (a) de RN-06: NUNCA se invoca prisma.transaction.update
      expect(prisma.transaction.update).not.toHaveBeenCalled();

      // 3. Mock para listTransactions devolviendo transacciones
      (prisma.transaction.findMany as any).mockResolvedValueOnce([
        {
          id: 10,
          organizationId: 1,
          paymentId: null,
          categoryId: 1,
          clientId: null,
          type: "INCOME" as const,
          amount: new Prisma.Decimal("100.00"),
          currency: "USD" as const,
          exchangeRate: new Prisma.Decimal("1512.500000"),
          transactionDate: new Date("2026-10-13T00:00:00.000Z"),
          description: null,
          voidedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          category: { id: 1, name: "Honorarios", type: "INCOME" },
          client: null,
        },
        oldTransaction,
      ]);

      const listResult = await listTransactions(1, {});

      // Verificación clave (b) de RN-06: listar NUNCA re-resuelve cotizaciones (getUsdExchangeRate no se vuelve a llamar)
      expect(exchangeRatesService.getUsdExchangeRate).toHaveBeenCalledTimes(1); // Sólo para createTransaction inicial
      expect(prisma.transaction.update).not.toHaveBeenCalled();

      expect(listResult).toHaveLength(2);
      expect(listResult[0]?.exchangeRate).toBe("1512.5");
      expect(listResult[1]?.exchangeRate).toBe("1450");
    });

    it("rechaza con 400 si la cotización oficial disponible tiene más de 5 días hábiles de antigüedad (P1)", async () => {
      // Movimiento del 14/10/2026 pero la cotización devuelta es del 25/09/2026 (> 5 días hábiles)
      vi.mocked(exchangeRatesService.getUsdExchangeRate).mockResolvedValueOnce({
        date: "2026-10-14",
        observedAt: "2026-09-25",
        value: "1450.000000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });

      const input = {
        type: "INCOME" as const,
        amount: "100.00",
        currency: "USD" as const,
        categoryId: 1,
        transactionDate: "2026-10-14",
        description: null,
      };

      await expect(createTransaction(1, input)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("más de 5 días hábiles de antigüedad"),
      });
    });

    it("registra en AuditLog si el tipo de cambio fue manual o del BCRA con trazabilidad completa (P1)", async () => {
      vi.mocked(exchangeRatesService.getUsdExchangeRate).mockResolvedValueOnce({
        date: "2026-10-13",
        observedAt: "2026-10-13",
        value: "1512.500000",
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
      });

      const input = {
        type: "INCOME" as const,
        amount: "200.00",
        currency: "USD" as const,
        categoryId: 1,
        transactionDate: "2026-10-13",
        description: null,
      };

      await createTransaction(1, input);

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "transaction.created",
            metadata: expect.objectContaining({
              exchangeRateSource: "BCRA",
              observedAt: "2026-10-13",
              exchangeRate: "1512.5",
            }),
          }),
        }),
      );
    });

    it("propaga el error 503 del servicio cuando el BCRA está caído (P2)", async () => {
      const { AppError } = await import("../../lib/error.js");
      vi.mocked(exchangeRatesService.getUsdExchangeRate).mockRejectedValueOnce(
        new AppError(
          503,
          "La cotización del BCRA no se encuentra disponible temporalmente. Por favor ingrese el valor manualmente.",
        ),
      );

      const input = {
        type: "INCOME" as const,
        amount: "100.00",
        currency: "USD" as const,
        categoryId: 1,
        transactionDate: "2026-10-13",
        description: null,
      };

      await expect(createTransaction(1, input)).rejects.toMatchObject({
        statusCode: 503,
        message: expect.stringContaining("La cotización del BCRA no se encuentra disponible"),
      });
    });

    it("valida categoría y cliente ANTES de consultar el tipo de cambio al BCRA (P2)", async () => {
      vi.mocked(prisma.category.findFirst).mockResolvedValueOnce(null); // Categoría no existe

      const input = {
        type: "INCOME" as const,
        amount: "100.00",
        currency: "USD" as const,
        categoryId: 999,
        transactionDate: "2026-10-13",
        description: null,
      };

      await expect(createTransaction(1, input)).rejects.toMatchObject({
        statusCode: 400,
        message: "Category not found or inactive",
      });

      // No debe haber llamado a la API del BCRA porque la categoría falló primero
      expect(exchangeRatesService.getUsdExchangeRate).not.toHaveBeenCalled();
    });

    it("rechaza tipo de cambio manual fuera de rango razonable (P2)", async () => {
      const inputOutLower = {
        type: "INCOME" as const,
        amount: "100.00",
        currency: "USD" as const,
        exchangeRate: "0.500000", // menor a 1
        categoryId: 1,
        transactionDate: "2026-10-13",
        description: null,
      };

      await expect(createTransaction(1, inputOutLower)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("rango razonable"),
      });

      const inputOutUpper = {
        type: "INCOME" as const,
        amount: "100.00",
        currency: "USD" as const,
        exchangeRate: "200000.000000", // mayor a 100000
        categoryId: 1,
        transactionDate: "2026-10-13",
        description: null,
      };

      await expect(createTransaction(1, inputOutUpper)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("rango razonable"),
      });
    });
  });
});
