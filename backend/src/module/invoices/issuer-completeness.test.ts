import { describe, expect, it } from "vitest";
import { issuerCompleteness, missingIssuerFields } from "./issuer-completeness.js";

const full = {
  legalName: "Recorrido SAS",
  cuit: "20000000001",
  taxCondition: "RESPONSABLE_INSCRIPTO",
  commercialAddress: "Av. Siempre Viva 742",
  activityStartDate: new Date("2020-03-01"),
  grossIncomeNumber: "901-123456-7",
};

describe("missingIssuerFields", () => {
  it("con todo cargado no falta nada", () => {
    expect(issuerCompleteness(full)).toEqual({ complete: true, missing: [] });
  });

  it("detecta vacíos y espacios en blanco en el orden del comprobante", () => {
    const res = missingIssuerFields({ ...full, legalName: " ", commercialAddress: null, activityStartDate: null });
    expect(res.map((m) => m.field)).toEqual(["legalName", "commercialAddress", "activityStartDate"]);
  });

  it("Ingresos Brutos es obligatorio salvo para monotributo", () => {
    expect(missingIssuerFields({ ...full, grossIncomeNumber: null }).map((m) => m.field)).toEqual(["grossIncomeNumber"]);
    expect(missingIssuerFields({ ...full, taxCondition: "EXENTO", grossIncomeNumber: null })).toHaveLength(1);
    expect(missingIssuerFields({ ...full, taxCondition: "MONOTRIBUTO", grossIncomeNumber: null })).toEqual([]);
  });
});
