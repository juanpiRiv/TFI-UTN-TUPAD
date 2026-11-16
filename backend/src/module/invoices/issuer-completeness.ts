/**
 * Datos del emisor que muestra un comprobante oficial de ARCA (RG 1415). Sin ellos no se autoriza contra ARCA real:
 * el comprobante saldría incompleto y ya no se puede corregir después de emitido.
 */
export interface IssuerData {
  legalName?: string | null;
  cuit?: string | null;
  taxCondition?: string | null;
  commercialAddress?: string | null;
  activityStartDate?: Date | null;
  grossIncomeNumber?: string | null;
}

export interface MissingIssuerField {
  field: "legalName" | "cuit" | "taxCondition" | "commercialAddress" | "activityStartDate" | "grossIncomeNumber";
  label: string;
}

export interface IssuerCompleteness {
  complete: boolean;
  missing: MissingIssuerField[];
}

const blank = (value: string | null | undefined) => value === null || value === undefined || value.trim() === "";

/**
 * Campos obligatorios: razón social, CUIT, condición frente al IVA, domicilio comercial y fecha de inicio de actividades.
 * Ingresos Brutos también, salvo para MONOTRIBUTO (no es contribuyente de IIBB por ese régimen en la práctica
 * y el comprobante oficial no lo exige). En el campo se acepta texto libre: un número, "Exento" o "Convenio Multilateral".
 */
export function missingIssuerFields(org: IssuerData): MissingIssuerField[] {
  const missing: MissingIssuerField[] = [];
  if (blank(org.legalName)) missing.push({ field: "legalName", label: "Razón social" });
  if (blank(org.cuit)) missing.push({ field: "cuit", label: "CUIT" });
  if (blank(org.taxCondition)) missing.push({ field: "taxCondition", label: "Condición frente al IVA" });
  if (blank(org.commercialAddress)) missing.push({ field: "commercialAddress", label: "Domicilio comercial" });
  if (!org.activityStartDate) missing.push({ field: "activityStartDate", label: "Fecha de inicio de actividades" });
  if (org.taxCondition !== "MONOTRIBUTO" && blank(org.grossIncomeNumber)) {
    missing.push({ field: "grossIncomeNumber", label: "Ingresos Brutos (número, Exento o Convenio)" });
  }
  return missing;
}

export function issuerCompleteness(org: IssuerData): IssuerCompleteness {
  const missing = missingIssuerFields(org);
  return { complete: missing.length === 0, missing };
}

export const issuerIncompleteMessage = (missing: MissingIssuerField[]) =>
  `Faltan datos del emisor para facturar: ${missing.map((m) => m.label).join(", ")}.`;
