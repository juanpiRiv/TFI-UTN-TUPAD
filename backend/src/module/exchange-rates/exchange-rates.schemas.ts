import { z } from "zod";

export const getUsdExchangeRateQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD"),
});

export type GetUsdExchangeRateQuery = z.infer<typeof getUsdExchangeRateQuerySchema>;

export interface ExchangeRateDto {
  date: string;
  observedAt: string;
  value: string;
  source: "BCRA" | "MANUAL";
  rateType: string;
}
