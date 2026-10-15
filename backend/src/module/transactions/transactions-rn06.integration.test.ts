import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { createTransaction, listTransactions } from "./transactions.service.js";

describe("RN-06: Inmutabilidad de cotizaciones históricas (PostgreSQL Integration Test)", () => {
  let testUserId: number;
  let testOrgId: number;
  let categoryId: number;
  const testDate = new Date("2026-10-10T00:00:00.000Z");
  const testDateStr = "2026-10-10";

  beforeAll(async () => {
    // 1. Crear usuario y organización de prueba con moneda base ARS
    const user = await prisma.user.create({
      data: {
        email: `test-rn06-${Date.now()}@test.com`,
        passwordHash: "hash123",
      },
    });
    testUserId = user.id;

    const cuitSuffix = String(Date.now()).slice(-8);
    const org = await prisma.organization.create({
      data: {
        userId: user.id,
        cuit: `23${cuitSuffix}`,
        legalName: "Org Test RN06",
        taxCondition: "MONOTRIBUTO",
        baseCurrency: "ARS",
      },
    });
    testOrgId = org.id;

    // 2. Crear categoría de ingresos
    const cat = await prisma.category.create({
      data: {
        organizationId: org.id,
        name: "Servicios Profesionales",
        type: "INCOME",
        isActive: true,
      },
    });
    categoryId = cat.id;

    // 3. Asegurar cotización en exchange_rates para USD a 1420.50 en testDate
    await prisma.exchangeRate.upsert({
      where: {
        source_rateType_fromCurrency_toCurrency_observedAt: {
          source: "BCRA",
          rateType: "ESTADISTICAS_CAMBIARIAS",
          fromCurrency: "USD",
          toCurrency: "ARS",
          observedAt: testDate,
        },
      },
      update: {
        value: new Prisma.Decimal("1420.500000"),
      },
      create: {
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
        fromCurrency: "USD",
        toCurrency: "ARS",
        value: new Prisma.Decimal("1420.500000"),
        observedAt: testDate,
      },
    });
  });

  afterAll(async () => {
    if (testOrgId) {
      await prisma.auditLog.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.transaction.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.category.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.organization.deleteMany({ where: { id: testOrgId } });
    }
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
    // Limpiar cotizaciones creadas para el test
    await prisma.exchangeRate.deleteMany({
      where: {
        observedAt: {
          in: [testDate, new Date("2026-10-15T00:00:00.000Z")],
        },
      },
    });
  });

  it("crea un movimiento con la cotización del día y confirma que modificar exchange_rates no altera el movimiento histórico (RN-06)", async () => {
    // 1. Crear transacción en USD para la fecha testDate
    const createdTx = await createTransaction(testUserId, {
      type: "INCOME",
      amount: "100.00",
      currency: "USD",
      categoryId,
      transactionDate: testDateStr,
      description: "Cobro inicial en USD",
    });

    expect(createdTx.currency).toBe("USD");
    expect(createdTx.exchangeRate).toBe("1420.5");

    // Verificar valor exacto en PostgreSQL
    const dbTxBefore = await prisma.transaction.findUniqueOrThrow({
      where: { id: createdTx.id },
    });
    expect(dbTxBefore.exchangeRate?.toString()).toBe("1420.5");

    // 2. Modificar la cotización en la tabla exchange_rates (p. ej. sube a 1700 o se actualiza)
    await prisma.exchangeRate.update({
      where: {
        source_rateType_fromCurrency_toCurrency_observedAt: {
          source: "BCRA",
          rateType: "ESTADISTICAS_CAMBIARIAS",
          fromCurrency: "USD",
          toCurrency: "ARS",
          observedAt: testDate,
        },
      },
      data: {
        value: new Prisma.Decimal("1700.000000"),
      },
    });

    // 3. Releer el movimiento desde PostgreSQL (mediante findUnique y listTransactions)
    const dbTxAfter = await prisma.transaction.findUniqueOrThrow({
      where: { id: createdTx.id },
    });
    // El movimiento en PostgreSQL NO FUE MODIFICADO (RN-06: copia fija en transactions.exchange_rate)
    expect(dbTxAfter.exchangeRate?.toString()).toBe("1420.5");

    const listed = await listTransactions(testUserId, {});
    const historicalTxInList = listed.find((t) => t.id === createdTx.id);
    expect(historicalTxInList).toBeDefined();
    expect(historicalTxInList?.exchangeRate).toBe("1420.5");

    // 4. Registrar una nueva transacción con nueva cotización y verificar que la vieja sigue intacta
    const newDate = new Date("2026-10-15T00:00:00.000Z");
    await prisma.exchangeRate.upsert({
      where: {
        source_rateType_fromCurrency_toCurrency_observedAt: {
          source: "BCRA",
          rateType: "ESTADISTICAS_CAMBIARIAS",
          fromCurrency: "USD",
          toCurrency: "ARS",
          observedAt: newDate,
        },
      },
      update: { value: new Prisma.Decimal("1850.000000") },
      create: {
        source: "BCRA",
        rateType: "ESTADISTICAS_CAMBIARIAS",
        fromCurrency: "USD",
        toCurrency: "ARS",
        value: new Prisma.Decimal("1850.000000"),
        observedAt: newDate,
      },
    });

    const newTx = await createTransaction(testUserId, {
      type: "INCOME",
      amount: "50.00",
      currency: "USD",
      categoryId,
      transactionDate: "2026-10-15",
      description: "Nuevo cobro con tasa actualizada",
    });

    expect(newTx.exchangeRate).toBe("1850");

    // Reconfirmar que la transacción vieja no cambió en PostgreSQL
    const dbTxOldFinal = await prisma.transaction.findUniqueOrThrow({
      where: { id: createdTx.id },
    });
    expect(dbTxOldFinal.exchangeRate?.toString()).toBe("1420.5");
  });
});
