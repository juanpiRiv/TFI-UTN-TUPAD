import { z } from "zod";

/**
 * Valida un string de fecha en formato ISO (YYYY-MM-DD) y comprueba
 * que la fecha exista realmente en el calendario (evita que fechas como 2026-02-31 se conviertan a 2026-03-03).
 */
export const isoDate = z
  .string({ error: "La fecha es requerida" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (esperado YYYY-MM-DD)")
  .refine(
    (v) => {
      const d = new Date(`${v}T00:00:00.000Z`);
      return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    },
    { message: "Fecha inexistente" },
  );
