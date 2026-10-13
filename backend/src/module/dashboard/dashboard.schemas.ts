import { z } from "zod";

export const dashboardSummaryQuerySchema = z
  .object({
    from: z
      .string({ error: "La fecha 'from' es requerida" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato 'from' inválido (esperado YYYY-MM-DD)"),
    to: z
      .string({ error: "La fecha 'to' es requerida" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato 'to' inválido (esperado YYYY-MM-DD)"),
  })
  .refine((data) => data.from <= data.to, {
    message: "'from' no puede ser posterior a 'to'",
    path: ["from"],
  });

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;
