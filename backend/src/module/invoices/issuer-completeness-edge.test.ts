import { describe, expect, it, vi } from "vitest";
import { issuerCompleteness, issuerIncompleteMessage, missingIssuerFields } from "./issuer-completeness.js";

const full = {
  legalName: "Recorrido SAS",
  cuit: "20000000001",
  taxCondition: "RESPONSABLE_INSCRIPTO",
  commercialAddress: "Av. Siempre Viva 742",
  activityStartDate: new Date("2020-03-01"),
  grossIncomeNumber: "901-123456-7",
};

const labels = {
  legalName: "Razón social",
  cuit: "CUIT",
  taxCondition: "Condición frente al IVA",
  commercialAddress: "Domicilio comercial",
  activityStartDate: "Fecha de inicio de actividades",
  grossIncomeNumber: "Ingresos Brutos (número, Exento o Convenio)",
} as const;

describe("issuerCompleteness (casos límite)", () => {
  const blanks: Array<[string, string | null | undefined]> = [
    ["espacios", "   "],
    ["tabulaciones y saltos de línea", "\t\n \r"],
    ["vacío", ""],
    ["null", null],
    ["undefined", undefined],
  ];

  describe.each(["legalName", "cuit", "taxCondition", "commercialAddress"] as const)("campo %s", (field) => {
    it.each(blanks)("%s falta, y es el único que falta", (_name, value) => {
      const result = issuerCompleteness({ ...full, [field]: value ?? null });
      expect(result.complete).toBe(false);
      expect(result.missing).toEqual([{ field, label: labels[field] }]);
    });
  });

  it.each(blanks)("grossIncomeNumber en %s falta para un responsable inscripto", (_name, value) => {
    expect(missingIssuerFields({ ...full, grossIncomeNumber: value ?? null }).map((m) => m.field)).toEqual(["grossIncomeNumber"]);
  });

  it("activityStartDate nula o ausente falta", () => {
    expect(missingIssuerFields({ ...full, activityStartDate: null }).map((m) => m.field)).toEqual(["activityStartDate"]);
    expect(missingIssuerFields({ legalName: full.legalName, cuit: full.cuit, taxCondition: full.taxCondition, commercialAddress: full.commercialAddress, grossIncomeNumber: full.grossIncomeNumber }).map((m) => m.field)).toEqual(["activityStartDate"]);
  });

  it("un objeto vacío lista los seis campos en el orden del comprobante", () => {
    expect(missingIssuerFields({}).map((m) => m.field)).toEqual(["legalName", "cuit", "taxCondition", "commercialAddress", "activityStartDate", "grossIncomeNumber"]);
  });

  it("monotributo no necesita Ingresos Brutos, pero los demás campos siguen siendo obligatorios", () => {
    const mono = { ...full, taxCondition: "MONOTRIBUTO", grossIncomeNumber: null };
    expect(issuerCompleteness(mono)).toEqual({ complete: true, missing: [] });
    expect(missingIssuerFields({ ...mono, commercialAddress: " " }).map((m) => m.field)).toEqual(["commercialAddress"]);
    // Monotributo con IIBB cargado también está completo.
    expect(issuerCompleteness({ ...mono, grossIncomeNumber: "Exento" }).complete).toBe(true);
  });

  it.each(["RESPONSABLE_INSCRIPTO", "EXENTO", "CONSUMIDOR_FINAL", "monotributo", " MONOTRIBUTO", "algo raro"])(
    "con condición %s Ingresos Brutos sigue siendo obligatorio (solo 'MONOTRIBUTO' exacto lo exime)",
    (taxCondition) => {
      expect(missingIssuerFields({ ...full, taxCondition, grossIncomeNumber: " " }).map((m) => m.field)).toEqual(["grossIncomeNumber"]);
    },
  );

  it("sin condición frente al IVA faltan la condición e Ingresos Brutos", () => {
    expect(missingIssuerFields({ ...full, taxCondition: null, grossIncomeNumber: null }).map((m) => m.field)).toEqual(["taxCondition", "grossIncomeNumber"]);
  });

  it("el texto con contenido real cuenta aunque traiga espacios alrededor", () => {
    expect(issuerCompleteness({ ...full, legalName: "  Recorrido  ", grossIncomeNumber: " Convenio Multilateral " }).complete).toBe(true);
  });

  it("el mensaje une las etiquetas en orden y termina en punto", () => {
    expect(issuerIncompleteMessage(missingIssuerFields({}))).toBe(
      "Faltan datos del emisor para facturar: Razón social, CUIT, Condición frente al IVA, Domicilio comercial, Fecha de inicio de actividades, Ingresos Brutos (número, Exento o Convenio).",
    );
    expect(issuerIncompleteMessage(missingIssuerFields({ ...full, cuit: null }))).toBe("Faltan datos del emisor para facturar: CUIT.");
  });
});

// ---- authorizeInvoice: el bloqueo por datos incompletos no consume número ni llama a ARCA ----

const dbMocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    organization: { findUnique: dbMocks.organizationFindUnique },
    $transaction: dbMocks.transaction,
    $queryRaw: dbMocks.queryRaw,
    $executeRaw: dbMocks.executeRaw,
  },
}));

describe("authorizeInvoice con datos del emisor incompletos", () => {
  const orgBase = {
    id: 5,
    cuit: "20000000001",
    legalName: "Recorrido SAS",
    tradeName: null,
    commercialAddress: "Av. Siempre Viva 742",
    taxCondition: "RESPONSABLE_INSCRIPTO",
    grossIncomeNumber: "901",
    activityStartDate: new Date("2020-03-01"),
  };

  const realProvider = () => ({
    name: "real",
    issuerCuit: orgBase.cuit,
    environment: "homologacion" as const,
    requestCae: vi.fn(),
    getLastAuthorized: vi.fn(),
    healthCheck: vi.fn(),
  });

  const attempt = async (provider: unknown) => {
    const { authorizeInvoice } = await import("./invoice-authorization.js");
    return authorizeInvoice(10, 99, async () => provider as never).catch((error: unknown) => error);
  };

  it("lanza 422 con la forma estable, sin tocar la base ni el proveedor", async () => {
    vi.clearAllMocks();
    dbMocks.organizationFindUnique.mockResolvedValue({ ...orgBase, commercialAddress: "  ", grossIncomeNumber: null, activityStartDate: null });
    const provider = realProvider();

    const error = (await attempt(provider)) as { statusCode: number; message: string; extra: Record<string, unknown> };

    expect(error.statusCode).toBe(422);
    expect(Object.keys(error.extra).sort()).toEqual(["code", "message", "missing", "missingFields"]);
    expect(error.extra).toEqual({
      message: "Faltan datos del emisor para facturar: Domicilio comercial, Fecha de inicio de actividades, Ingresos Brutos (número, Exento o Convenio).",
      code: "ISSUER_INCOMPLETE",
      missing: ["commercialAddress", "activityStartDate", "grossIncomeNumber"],
      missingFields: [
        { field: "commercialAddress", label: "Domicilio comercial" },
        { field: "activityStartDate", label: "Fecha de inicio de actividades" },
        { field: "grossIncomeNumber", label: "Ingresos Brutos (número, Exento o Convenio)" },
      ],
    });
    expect(error.message).toBe(error.extra.message);
    // Ni transacción (reserva y numeración), ni consultas, ni ARCA.
    expect(dbMocks.transaction).not.toHaveBeenCalled();
    expect(dbMocks.queryRaw).not.toHaveBeenCalled();
    expect(dbMocks.executeRaw).not.toHaveBeenCalled();
    expect(provider.requestCae).not.toHaveBeenCalled();
    expect(provider.getLastAuthorized).not.toHaveBeenCalled();
  });

  it("la respuesta HTTP que arma el handler tiene exactamente error, message, code, missing y missingFields", async () => {
    const { errorHandler } = await import("../../middlewares/error-handler.js");
    dbMocks.organizationFindUnique.mockResolvedValue({ ...orgBase, legalName: " " });
    const error = await attempt(realProvider());
    const res = { body: undefined as unknown, status() { return this; }, json(body: unknown) { this.body = body; return this; } };

    errorHandler(error, {} as never, res as never, (() => {}) as never);

    expect(Object.keys(JSON.parse(JSON.stringify(res.body))).sort()).toEqual(["code", "error", "message", "missing", "missingFields"]);
  });

  it("con el simulador no se bloquea: llega hasta la reserva aunque falte todo", async () => {
    vi.clearAllMocks();
    dbMocks.organizationFindUnique.mockResolvedValue({ ...orgBase, legalName: "", commercialAddress: null, grossIncomeNumber: null, activityStartDate: null });
    dbMocks.transaction.mockRejectedValue(new Error("llegó a la reserva"));
    const { ArcaSimulatedClient } = await import("../arca/simulated/arca-simulated-client.js");

    const error = await attempt(new ArcaSimulatedClient());

    expect((error as Error).message).toBe("llegó a la reserva");
    expect(dbMocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("un proveedor real con los datos completos pasa el control y llega a la reserva", async () => {
    vi.clearAllMocks();
    dbMocks.organizationFindUnique.mockResolvedValue(orgBase);
    dbMocks.transaction.mockRejectedValue(new Error("llegó a la reserva"));

    expect(((await attempt(realProvider())) as Error).message).toBe("llegó a la reserva");
  });

  it("el CUIT del certificado distinto se informa antes que los datos incompletos (409, no 422)", async () => {
    dbMocks.organizationFindUnique.mockResolvedValue({ ...orgBase, commercialAddress: null });

    const error = (await attempt({ ...realProvider(), issuerCuit: "30711111118" })) as { statusCode: number };

    expect(error.statusCode).toBe(409);
  });
});
