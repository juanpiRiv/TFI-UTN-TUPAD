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
    invoice: {
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
});

describe("getDashboardSummary service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 1,
      baseCurrency: "ARS",
    } as any);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
  });

  it("devuelve valores en cero y lista vacía cuando no hay movimientos ni facturas", async () => {
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
      invoiced: "0.00",
      collected: "0.00",
      difference: "0.00",
      managementResult: "0.00",
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

  it("distingue lo facturado de lo efectivamente cobrado en el período a partir de datos reales (Issue #53 / RF-33)", async () => {
    // Escenario de Lucía (docs/04-factura-cobro-y-pagos.md):
    // - Factura C autorizada de $100.000 emitida el 10/09
    // - Pago real de $40.000 cobrado el 15/09 (con su Transaction de ingreso en caja con paymentId = 10)
    // - Egreso manual de $15.000 en software el 20/09
    // Resultados esperados:
    // - Facturado = $ 100.000,00
    // - Cobrado = $ 40.000,00 (calculado a partir de Transaction con paymentId != null)
    // - Diferencia (facturado menos cobrado en el período) = $ 60.000,00
    // - Resultado de caja = $ 25.000,00 (40.000 - 15.000)
    // - Resultado de gestión = $ 85.000,00 (100.000 - 15.000)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        totalAmount: new Prisma.Decimal("100000.00"),
        currency: "ARS",
        fiscalExchangeRate: new Prisma.Decimal("1.00"),
      },
    ] as any);

    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        id: 1,
        paymentId: 10, // Proviene del pago de la factura
        type: "INCOME",
        amount: new Prisma.Decimal("40000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 10,
        category: { id: 10, name: "Cobro de facturas", type: "INCOME" },
      },
      {
        id: 2,
        paymentId: null,
        type: "EXPENSE",
        amount: new Prisma.Decimal("15000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 20,
        category: { id: 20, name: "Software", type: "EXPENSE" },
      },
    ] as any);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    // Criterio 1: El dashboard muestra ambos números por separado
    expect(summary.invoiced).toBe("100000.00");
    expect(summary.collected).toBe("40000.00");

    // Criterio 2: La diferencia surge de datos reales
    expect(summary.difference).toBe("60000.00");

    // Resultado de caja vs Resultado de gestión
    expect(summary.income).toBe("40000.00");
    expect(summary.expense).toBe("15000.00");
    expect(summary.net).toBe("25000.00");
    expect(summary.managementResult).toBe("85000.00");
  });

  it("convierte facturas en USD con tipo de cambio fiscal al calcular lo facturado", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        totalAmount: new Prisma.Decimal("100.00"),
        currency: "USD",
        fiscalExchangeRate: new Prisma.Decimal("1400.000000"), // 100 * 1400 = 140000 ARS
      },
    ] as any);

    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(summary.invoiced).toBe("140000.00");
    expect(summary.collected).toBe("0.00");
    expect(summary.difference).toBe("140000.00");
  });

  it("calcula 'collected' directamente desde los movimientos vinculados a pagos (paymentId != null) evitando divergencias por adopción (Issue #53 P1)", async () => {
    // Escenario de adopción de movimiento:
    // Un movimiento manual existente de ingreso con su propio cambio/fecha es adoptado por un cobro de factura.
    // 'collected' e 'income' provienen de la misma fuente única de verdad (Transaction), sin riesgo de drift.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        id: 101,
        paymentId: 55, // Movimiento adoptado por el pago 55
        type: "INCOME",
        amount: new Prisma.Decimal("100.00"),
        currency: "USD",
        exchangeRate: new Prisma.Decimal("1500.000000"), // 150.000 ARS
        categoryId: 10,
        category: { id: 10, name: "Cobros", type: "INCOME" },
      },
      {
        id: 102,
        paymentId: null, // Ingreso manual no vinculado a factura
        type: "INCOME",
        amount: new Prisma.Decimal("50000.00"),
        currency: "ARS",
        exchangeRate: null,
        categoryId: 10,
        category: { id: 10, name: "Ventas", type: "INCOME" },
      },
    ] as any);

    const summary = await getDashboardSummary(1, {
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(summary.collected).toBe("150000.00");
    expect(summary.income).toBe("200000.00");
    expect(summary.managementResult).toBe("50000.00"); // manualIncome (50.000) + invoiced (0) - expense (0)
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


