import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
} from "./transactions.schemas.js";
import { createTransaction, listTransactions } from "./transactions.service.js";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { exchangeRatesService } from "../exchange-rates/exchange-rates.service.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(prisma)),
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
    auditLog: {
      create: vi.fn(),
    },
  },
}));

describe("Transactions Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

    it("rejects amount exceeding 16 integer digits (numeric overflow prevention)", () => {
      const result = createTransactionSchema.safeParse({
        type: "INCOME",
        amount: "99999999999999999999.00",
        currency: "ARS",
        categoryId: 1,
        transactionDate: "2026-10-13",
      });
      expect(result.success).toBe(false);
    });

    it("rejects exchange rate exceeding 12 integer digits (numeric overflow prevention)", () => {
      const result = createTransactionSchema.safeParse({
        type: "EXPENSE",
        amount: "100.00",
        currency: "USD",
        exchangeRate: "9999999999999.000000",
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

    it("rejects non-existent calendar date like 2026-02-31", () => {
      const result = createTransactionSchema.safeParse({
        type: "INCOME",
        amount: "100.00",
        currency: "ARS",
        categoryId: 1,
        transactionDate: "2026-02-31",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Fecha inexistente");
      }
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

  describe("listTransactionsQuerySchema", () => {
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

    it("parses combined filters with dates, type, category, client, and default limit 50", () => {
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
        expect(result.data.limit).toBe(50);
      }
    });

    it("rejects when 'from' is after 'to'", () => {
      const result = listTransactionsQuerySchema.safeParse({
        from: "2026-10-31",
        to: "2026-10-01",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("'from' no puede ser posterior a 'to'");
      }
    });

    it("rejects non-existent date in query filter", () => {
      const result = listTransactionsQuerySchema.safeParse({
        from: "2026-02-31",
        to: "2026-03-05",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Fecha inexistente");
      }
    });

    it("validates custom limit within allowed bounds (1 to 100)", () => {
      const valid = listTransactionsQuerySchema.safeParse({ limit: "25" });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.limit).toBe(25);
      }

      const tooHigh = listTransactionsQuerySchema.safeParse({ limit: "150" });
      expect(tooHigh.success).toBe(false);

      const zero = listTransactionsQuerySchema.safeParse({ limit: "0" });
      expect(zero.success).toBe(false);
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

  describe("Transactions Service", () => {
    const mockOrg = {
      id: 1,
      baseCurrency: "ARS",
    };

    it("creates a transaction and records an audit log atomically", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.category.findFirst).mockResolvedValue({
        id: 1,
        organizationId: 1,
        name: "Honorarios",
        type: "INCOME",
        isActive: true,
      } as any);

      const createdTx = {
        id: 10,
        organizationId: 1,
        paymentId: null,
        categoryId: 1,
        clientId: null,
        type: "INCOME",
        amount: new Prisma.Decimal("1000.00"),
        currency: "ARS",
        exchangeRate: null,
        transactionDate: new Date("2026-10-15T00:00:00.000Z"),
        description: "Cobro cliente",
        voidedAt: null,
        createdAt: new Date("2026-10-15T12:00:00.000Z"),
        updatedAt: new Date("2026-10-15T12:00:00.000Z"),
        category: { id: 1, name: "Honorarios", type: "INCOME" },
        client: null,
      };

      vi.mocked(prisma.transaction.create).mockResolvedValue(createdTx as any);

      const result = await createTransaction(1, {
        type: "INCOME",
        amount: "1000.00",
        currency: "ARS",
        categoryId: 1,
        transactionDate: "2026-10-15",
        description: "Cobro cliente",
      });

      expect(result.id).toBe(10);
      expect(result.amount).toBe("1000");
      expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 1,
          userId: 1,
          action: "transaction.created",
          entity: "Transaction",
          entityId: 10,
        }),
      });
    });

    it("rejects creating transaction if client is inactive", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.category.findFirst).mockResolvedValue({
        id: 1,
        organizationId: 1,
        name: "Honorarios",
        type: "INCOME",
        isActive: true,
      } as any);

      // Client findFirst returns null because isActive is false
      vi.mocked(prisma.client.findFirst).mockResolvedValue(null);

      await expect(
        createTransaction(1, {
          type: "INCOME",
          amount: "1000.00",
          currency: "ARS",
          categoryId: 1,
          clientId: 99,
          transactionDate: "2026-10-15",
          description: null,
        }),
      ).rejects.toThrow("Client not found or inactive");

      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: {
          id: 99,
          organizationId: 1,
          isActive: true,
        },
      });
    });

    it("builds combined where clause with type, category, client, and date range", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      const query = {
        from: "2026-10-01",
        to: "2026-10-31",
        type: "EXPENSE" as const,
        categoryId: 4,
        clientId: 2,
        limit: 25,
      };

      await listTransactions(1, query);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 1,
          voidedAt: null,
          type: "EXPENSE",
          categoryId: 4,
          clientId: 2,
          transactionDate: {
            gte: new Date("2026-10-01T00:00:00.000Z"),
            lte: new Date("2026-10-31T00:00:00.000Z"),
          },
        },
        take: 25,
        orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
        include: {
          category: { select: { id: true, name: true, type: true } },
          client: { select: { id: true, name: true } },
        },
      });
    });

    it("includes transactions on the exact boundary date of the range (to inclusivo)", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(mockOrg as any);

      const boundaryTx = {
        id: 50,
        organizationId: 1,
        paymentId: null,
        categoryId: 4,
        clientId: null,
        type: "EXPENSE",
        amount: new Prisma.Decimal("250.00"),
        currency: "ARS",
        exchangeRate: null,
        transactionDate: new Date("2026-10-31T00:00:00.000Z"),
        description: "Gasto de fin de mes",
        voidedAt: null,
        createdAt: new Date("2026-10-31T10:00:00.000Z"),
        updatedAt: new Date("2026-10-31T10:00:00.000Z"),
        category: { id: 4, name: "Servicios", type: "EXPENSE" },
        client: null,
      };

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([boundaryTx] as any);

      const results = await listTransactions(1, {
        from: "2026-10-01",
        to: "2026-10-31",
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.transactionDate).toBe("2026-10-31");
      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            transactionDate: {
              gte: new Date("2026-10-01T00:00:00.000Z"),
              lte: new Date("2026-10-31T00:00:00.000Z"),
            },
          }),
        }),
      );
    });

    it("applies limit (take) when listing transactions defaulting to 50", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      await listTransactions(1, {});

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        }),
      );
    });

    it("applies custom limit (take) when listing transactions", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      await listTransactions(1, { limit: 20 });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        }),
      );
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
