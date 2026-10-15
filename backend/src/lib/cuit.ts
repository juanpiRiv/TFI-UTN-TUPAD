const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/**
 * Valida el dígito verificador de un CUIT/CUIL según algoritmo módulo 11 de AFIP/ARCA.
 * Admite formato con o sin guiones/espacios.
 */
export function isValidCuit(cuit: string): boolean {
  const clean = cuit.replace(/[-\s]/g, "");
  if (!/^\d{11}$/.test(clean)) return false;
  const digits = clean.split("").map(Number);
  const sum = CUIT_WEIGHTS.reduce(
    (total, weight, index) => total + weight * (digits[index] ?? 0),
    0,
  );
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? 0 : remainder;
  return expected !== 10 && expected === digits[10];
}
