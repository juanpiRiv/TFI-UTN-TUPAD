import { z } from "zod";
import { isoDate } from "../../lib/date.js";

export const dashboardSummaryQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((data) => data.from <= data.to, {
    message: "'from' no puede ser posterior a 'to'",
    path: ["from"],
  });

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;
