import { describe, it, expect } from "vitest";
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
} from "./transactions.schemas.js";

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
});
