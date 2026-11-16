import { randomInt } from "node:crypto";
import { isValidCuit } from "../lib/cuit.js";

const issued = new Set<string>();

/**
 * CUIT válido (dígito verificador módulo 11) y único para los tests de integración.
 *
 * Las suites corren en procesos distintos contra la misma base y `cuit` es único en `organizations`.
 * Un contador derivado de la hora chocaba de forma intermitente entre suites; acá cada CUIT sale de
 * un número aleatorio criptográfico y no se repite dentro del mismo proceso.
 */
export function uniqueCuit(prefix: "20" | "23" | "24" | "27" | "30" = "20"): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const base = `${prefix}${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    for (let digit = 0; digit <= 9; digit++) {
      const cuit = `${base}${digit}`;
      if (isValidCuit(cuit) && !issued.has(cuit)) {
        issued.add(cuit);
        return cuit;
      }
    }
  }
  throw new Error("No se pudo generar un CUIT único para el test.");
}
