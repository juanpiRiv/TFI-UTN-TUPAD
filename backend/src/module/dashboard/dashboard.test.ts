import { describe, it, expect, vi, beforeEach } from "vitest";
import { dashboardSummaryQuerySchema } from "./dashboard.schemas.js";
import { getDashboardSummary } from "./dashboard.service.js";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
  },
}));

describe("dashboardSummaryQuerySchema", () => {
  it("valida un período correcto", () => {
    const result = dashboardSummaryQuerySchema.safeParse({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBe("2026-09-01");
      expect(result.data.to).toBe("2026-09-30");
    }
  });

  it("acepta un período donde 'from' y 'to' son el mismo día", () => {
    const result = dashboardSummaryQuerySchema.safeParse({
      from: "2026-09-15",
      to: "2026-09-15",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza si falta 'from'", () => {
    const result = dashboardSummaryQuerySchema.safeParse({
      to: "2026-09-30",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza si falta 'to'", () => {
    const result = dashboardSummaryQuerySchema.safeParse({
      from: "2026-09-01",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza formatos de fecha inválidos", () => {
    const invalidFormats = [
      { from: "01-09-2026", to: "2026-09-30" },
      { from: "2026/09/01", to: "2026-09-30" },
      { from: "not-a-date", to: "2026-09-30" },
      { from: "2026-09-01", to: "2026-9-30" },
    ];
    for (const testCase of invalidFormats) {
      const result = dashboardSummaryQuerySchema.safeParse(testCase);
      expect(result.success).toBe(false);
    }
  });

  it("rechaza cuando 'from' es posterior a 'to'", () => {
    const result = dashboardSummaryQuerySchema.safeParse({
      from: "2026-10-01",
      to: "2026-09-30",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message;
      expect(message).toBe("'from' no puede ser posterior a 'to'");
    }
  });

  it("rechaza fechas inexistentes en el calendario (ej: 2026-02-31)", () => {
    const resultFrom = dashboardSummaryQuerySchema.safeParse({
      from: "2026-02-31",
      to: "2026-03-01",
    });
    expect(resultFrom.success).toBe(false);

    const resultTo = dashboardSummaryQuerySchema.safeParse({
      from: "2026-02-01",
      to: "2026-02-31",
    });
    expect(resultTo.success).toBe(false);
  });
});

describe("getDashboardSummary service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 1,
      baseCurrency: "ARS",
    } as any);
  });

  it("devuelve valores en cero y lista vacía cuando no hay movimientos", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(summary).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      currency: "ARS",
      income: "0.00",
      expense: "0.00",
      net: "0.00",
      transactionCount: 0,
      byCategory: [],
    });
  });

  it("calcula totales de ingresos, egresos y resultado neto correctamente", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        id: 1,
        type: "INCOME",
        amount: new Prisma.Decimal("100000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 10,
        category: { id: 10, name: "Ventas", type: "INCOME" },
      },
      {
        id: 2,
        type: "EXPENSE",
        amount: new Prisma.Decimal("15000.50"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 20,
        category: { id: 20, name: "Alquiler", type: "EXPENSE" },
      },
    ] as any);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(summary.income).toBe("100000.00");
    expect(summary.expense).toBe("15000.50");
    expect(summary.net).toBe("84999.50");
    expect(summary.transactionCount).toBe(2);
    expect(summary.byCategory).toHaveLength(2);
    expect(summary.byCategory[0]).toEqual({
      categoryId: 10,
      name: "Ventas",
      type: "INCOME",
      total: "100000.00",
    });
    expect(summary.byCategory[1]).toEqual({
      categoryId: 20,
      name: "Alquiler",
      type: "EXPENSE",
      total: "15000.50",
    });
  });

  it("soporta resultado neto negativo cuando los egresos superan los ingresos", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        id: 1,
        type: "INCOME",
        amount: new Prisma.Decimal("5000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 10,
        category: { id: 10, name: "Ventas", type: "INCOME" },
      },
      {
        id: 2,
        type: "EXPENSE",
        amount: new Prisma.Decimal("6500.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 20,
        category: { id: 20, name: "Servicios", type: "EXPENSE" },
      },
    ] as any);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(summary.income).toBe("5000.00");
    expect(summary.expense).toBe("6500.00");
    expect(summary.net).toBe("-1500.00");
  });

  it("convierte movimientos en moneda extranjera a la moneda base usando exchangeRate", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        id: 1,
        type: "INCOME",
        amount: new Prisma.Decimal("100.00"), // 100 USD
        currency: "USD",
        exchangeRate: new Prisma.Decimal("1400.00"), // 100 * 1400 = 140000 ARS
        categoryId: 10,
        category: { id: 10, name: "Ventas Exterior", type: "INCOME" },
      },
      {
        id: 2,
        type: "EXPENSE",
        amount: new Prisma.Decimal("20000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 20,
        category: { id: 20, name: "Impuestos", type: "EXPENSE" },
      },
    ] as any);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(summary.income).toBe("140000.00");
    expect(summary.expense).toBe("20000.00");
    expect(summary.net).toBe("120000.00");
    expect(summary.byCategory[0]?.total).toBe("140000.00");
  });

  it("agrupa múltiples movimientos de la misma categoría y ordena descendente por total", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        id: 1,
        type: "INCOME",
        amount: new Prisma.Decimal("30000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 10,
        category: { id: 10, name: "Ventas Locales", type: "INCOME" },
      },
      {
        id: 2,
        type: "INCOME",
        amount: new Prisma.Decimal("70000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 10,
        category: { id: 10, name: "Ventas Locales", type: "INCOME" },
      },
      {
        id: 3,
        type: "EXPENSE",
        amount: new Prisma.Decimal("150000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 30,
        category: { id: 30, name: "Alquiler Galpón", type: "EXPENSE" },
      },
    ] as any);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(summary.byCategory).toHaveLength(2);
    // 150000 > 100000 => Alquiler Galpón primero
    expect(summary.byCategory[0]).toEqual({
      categoryId: 30,
      name: "Alquiler Galpón",
      type: "EXPENSE",
      total: "150000.00",
    });
    // Ventas Locales: 30000 + 70000 = 100000.00
    expect(summary.byCategory[1]).toEqual({
      categoryId: 10,
      name: "Ventas Locales",
      type: "INCOME",
      total: "100000.00",
    });
  });

  it("convierte y suma movimientos multimoneda con distintas cotizaciones históricas sin sobreescribirlas (Issue #39)", async () => {
    // Escenario con montos idénticos (50 USD) para contrastar directamente el efecto de la cotización:
    // 1. Ingreso 50 USD con cotización histórica sugerida BCRA (1512.50) -> 75.625,00 ARS
    // 2. Ingreso 50 USD con cotización histórica personalizada/manual (1500.00) -> 75.000,00 ARS
    //    Total categoría "Cobro de facturas" = 150.625,00 ARS
    // 3. Ingreso 10.000,00 ARS en moneda base local
    //    Total general de ingresos = 160.625,00 ARS
    // 4. Egreso 5.000,00 ARS en servicios
    // Resultado neto esperado = 155.625,00 ARS
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        id: 1,
        type: "INCOME",
        amount: new Prisma.Decimal("50.00"),
        currency: "USD",
        exchangeRate: new Prisma.Decimal("1512.500000"),
        categoryId: 10,
        category: { id: 10, name: "Cobro de facturas", type: "INCOME" },
      },
      {
        id: 2,
        type: "INCOME",
        amount: new Prisma.Decimal("50.00"),
        currency: "USD",
        exchangeRate: new Prisma.Decimal("1500.000000"),
        categoryId: 10,
        category: { id: 10, name: "Cobro de facturas", type: "INCOME" },
      },
      {
        id: 3,
        type: "INCOME",
        amount: new Prisma.Decimal("10000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 11,
        category: { id: 11, name: "Otros Ingresos", type: "INCOME" },
      },
      {
        id: 4,
        type: "EXPENSE",
        amount: new Prisma.Decimal("5000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 20,
        category: { id: 20, name: "Servicios", type: "EXPENSE" },
      },
    ] as any);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(summary.currency).toBe("ARS");
    expect(summary.income).toBe("160625.00");
    expect(summary.expense).toBe("5000.00");
    expect(summary.net).toBe("155625.00");
    expect(summary.transactionCount).toBe(4);

    const cobroCat = summary.byCategory.find((c) => c.name === "Cobro de facturas");
    expect(cobroCat).toBeDefined();
    expect(cobroCat?.total).toBe("150625.00");
  });

  it("filtra por organización, excluye transacciones anuladas y aplica el rango de fechas", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 1,
          voidedAt: null,
          transactionDate: {
            gte: new Date("2026-09-01T00:00:00.000Z"),
            lte: new Date("2026-09-30T00:00:00.000Z"),
          },
        },
      }),
    );
  });

  it("lanza un error si un movimiento en moneda extranjera no tiene exchangeRate (RN-05)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        id: 99,
        type: "INCOME",
        amount: new Prisma.Decimal("100.00"),
        currency: "USD",
        exchangeRate: null,
        categoryId: 10,
        category: { id: 10, name: "Ventas", type: "INCOME" },
      },
    ] as any);

    await expect(
      getDashboardSummary(1, {
        from: "2026-09-01",
        to: "2026-09-30",
      }),
    ).rejects.toThrow("Transaction 99 in USD is missing exchangeRate");
  });
});

