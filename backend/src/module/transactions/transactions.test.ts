import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
} from "./transactions.schemas.js";
import { createTransaction, listTransactions } from "./transactions.service.js";
import { prisma } from "../../lib/prisma.js";
import { getUsdExchangeRate } from "../exchange-rates/exchange-rates.service.js";
import { Prisma } from "../../generated/prisma/client.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
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
    },
  },
}));

vi.mock("../exchange-rates/exchange-rates.service.js", () => ({
  getUsdExchangeRate: vi.fn(),
}));

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
      } as any);

      (prisma.transaction.create as any).mockImplementation(async ({ data }: any) => ({
        id: 10,
        organizationId: data.organizationId,
        categoryId: data.categoryId,
        clientId: data.clientId,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        transactionDate: data.transactionDate,
        description: data.description,
        createdAt: new Date(),
        updatedAt: new Date(),
        isVoided: false,
        voidedAt: null,
        voidReason: null,
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
      expect(getUsdExchangeRate).not.toHaveBeenCalled();
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
      vi.mocked(getUsdExchangeRate).mockResolvedValueOnce({
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

      expect(getUsdExchangeRate).toHaveBeenCalledWith("2026-10-13");
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
      expect(getUsdExchangeRate).not.toHaveBeenCalled();
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: "ARS",
            exchangeRate: null,
          }),
        }),
      );
    });

    it("RN-06: confirmar que modificar la cotización actual no toca movimientos viejos", async () => {
      // 1. Movimiento histórico de ayer con cotización 1450.00 ARS
      const oldTransaction = {
        id: 1,
        organizationId: 1,
        categoryId: 1,
        clientId: null,
        type: "INCOME" as const,
        amount: new Prisma.Decimal("100.00"),
        currency: "USD" as const,
        exchangeRate: new Prisma.Decimal("1450.000000"), // copia histórica fija
        transactionDate: new Date("2026-10-12T00:00:00.000Z"),
        description: "Cobro cliente ayer",
        createdAt: new Date("2026-10-12T10:00:00.000Z"),
        updatedAt: new Date("2026-10-12T10:00:00.000Z"),
        isVoided: false,
        voidedAt: null,
        voidReason: null,
        category: { id: 1, name: "Honorarios", type: "INCOME" },
        client: null,
      };

      // 2. Hoy la cotización del BCRA sube a 1512.50 ARS y se registra un movimiento hoy
      vi.mocked(getUsdExchangeRate).mockResolvedValueOnce({
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

      // El movimiento de hoy guarda la cotización actual (1512.5)
      expect(todayTransaction.exchangeRate).toBe("1512.5");

      // 3. Al listar los movimientos, el movimiento viejo conserva inmutable su cotización histórica de 1450 (RN-06)
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        {
          id: 10,
          organizationId: 1,
          categoryId: 1,
          clientId: null,
          type: "INCOME" as const,
          amount: new Prisma.Decimal("100.00"),
          currency: "USD" as const,
          exchangeRate: new Prisma.Decimal("1512.500000"),
          transactionDate: new Date("2026-10-13T00:00:00.000Z"),
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          isVoided: false,
          voidedAt: null,
          voidReason: null,
          category: { id: 1, name: "Honorarios", type: "INCOME" },
          client: null,
        },
        oldTransaction,
      ] as any);

      const listResult = await listTransactions(1, {});

      expect(listResult).toHaveLength(2);
      expect(listResult[0]?.exchangeRate).toBe("1512.5"); // Movimiento de hoy con cotización actual
      expect(listResult[1]?.exchangeRate).toBe("1450");   // Movimiento histórico de ayer inalterado (RN-06)
    });
  });
});
