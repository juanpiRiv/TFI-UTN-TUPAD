import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
} from "./transactions.schemas.js";
import { createTransaction, listTransactions } from "./transactions.service.js";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";

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
    it("parses valid filters with default limit", () => {
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

    it("applies limit (take) when listing transactions", async () => {
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
});
