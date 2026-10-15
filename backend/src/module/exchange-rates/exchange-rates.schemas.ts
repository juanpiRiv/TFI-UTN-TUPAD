import { z } from "zod";
import { isoDate } from "../../lib/date.js";

export const getUsdExchangeRateQuerySchema = z.object({
  date: isoDate,
});

export type GetUsdExchangeRateQuery = z.infer<typeof getUsdExchangeRateQuerySchema>;

export interface ExchangeRateDto {
  date: string;
  observedAt: string;
  value: string;
  source: "BCRA" | "MANUAL";
  rateType: string;
}
