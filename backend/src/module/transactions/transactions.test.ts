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

  describe("listTransactionsQuerySchema", () => {
    it("parses valid filters", () => {
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
        expect(result.data.categoryId).toBe(1);
        expect(result.data.clientId).toBe(2);
      }
    });

    it("rejects invalid date filter", () => {
      const result = listTransactionsQuerySchema.safeParse({ from: "invalid-date" });
      expect(result.success).toBe(false);
    });
  });
});
