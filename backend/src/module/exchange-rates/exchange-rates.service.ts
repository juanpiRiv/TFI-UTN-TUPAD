import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/error.js";
import type { ExchangeRateDto } from "./exchange-rates.schemas.js";

const BCRA_BASE_URL = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones";
const SOURCE_BCRA = "BCRA";
const RATE_TYPE_ESTADISTICAS = "ESTADISTICAS_CAMBIARIAS";
const RATE_TYPE_REF = "COM_A_3500";
const REQUEST_TIMEOUT_MS = 10000;

interface BcraDetalle {
  codigoMoneda: string;
  descripcion: string;
  tipoPase: number;
  tipoCotizacion: number;
}

interface BcraItem {
  fecha: string;
  detalle: BcraDetalle[];
}

interface BcraResponse {
  status: number;
  results?: BcraItem[];
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function subDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

function parseUtcDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function getPrecedingFriday(date: Date): Date {
  const day = date.getUTCDay();
  if (day === 6) return subDays(date, 1); // Sábado -> Viernes
  if (day === 0) return subDays(date, 2); // Domingo -> Viernes
  return date;
}

/**
 * Consulta la API oficial del BCRA para una serie y rango de fechas dado.
 */
async function fetchFromBcra(
  currencyCode: "USD" | "REF",
  fromStr: string,
  toStr: string,
): Promise<BcraItem[]> {
  const url = `${BCRA_BASE_URL}/${currencyCode}?fechadesde=${fromStr}&fechahasta=${toStr}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TFI-UTN-TUPAD/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`BCRA API responded with HTTP ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as BcraResponse;
  return data.results ?? [];
}

/**
 * Persiste las cotizaciones obtenidas del BCRA en la base de datos (cache).
 */
async function persistRates(
  items: BcraItem[],
  currencyCode: "USD" | "REF",
  rateType: string,
): Promise<void> {
  for (const item of items) {
    const detail = item.detalle.find((d) => d.codigoMoneda === currencyCode) ?? item.detalle[0];
    if (!detail || typeof detail.tipoCotizacion !== "number" || isNaN(detail.tipoCotizacion)) {
      continue;
    }

    const observedAt = parseUtcDate(item.fecha);
    const value = new Prisma.Decimal(detail.tipoCotizacion.toFixed(6));

    await prisma.exchangeRate.upsert({
      where: {
        source_rateType_fromCurrency_toCurrency_observedAt: {
          source: SOURCE_BCRA,
          rateType,
          fromCurrency: "USD",
          toCurrency: "ARS",
          observedAt,
        },
      },
      create: {
        source: SOURCE_BCRA,
        rateType,
        fromCurrency: "USD",
        toCurrency: "ARS",
        value,
        observedAt,
      },
      update: {
        value,
      },
    });
  }
}

/**
 * Extrae la cotización correspondiente de un listado de resultados devueltos por el BCRA,
 * buscando la última fecha hábil menor o igual a targetDateStr.
 */
function extractMatchingRate(
  results: BcraItem[],
  currencyCode: "USD" | "REF",
  targetDateStr: string,
  requestedDateStr: string,
  rateType: string,
): ExchangeRateDto | null {
  const sorted = [...results].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const match = sorted.find((r) => r.fecha <= targetDateStr) ?? sorted[0];
  if (!match) return null;

  const detail = match.detalle.find((d) => d.codigoMoneda === currencyCode) ?? match.detalle[0];
  if (!detail || typeof detail.tipoCotizacion !== "number" || isNaN(detail.tipoCotizacion)) {
    return null;
  }

  return {
    date: requestedDateStr,
    observedAt: match.fecha,
    value: detail.tipoCotizacion.toFixed(6),
    source: SOURCE_BCRA,
    rateType,
  };
}

/**
 * Obtiene la cotización del dólar (USD a ARS) para la fecha solicitada.
 * Aplica estrategia de caché en base de datos, consulta al BCRA con ventana histórica de 10 días,
 * resolución del último día hábil anterior o igual a la fecha, y fallback ordenado.
 */
export async function getUsdExchangeRate(requestedDateStr: string): Promise<ExchangeRateDto> {
  const requestedDate = parseUtcDate(requestedDateStr);
  const now = new Date();
  const todayStr = formatDate(now);

  // El BCRA rechaza fechas futuras con 400. Si piden fecha futura, se acota a hoy.
  const targetDateStr = requestedDateStr > todayStr ? todayStr : requestedDateStr;
  const targetDate = parseUtcDate(targetDateStr);

  // 1. Revisar si ya tenemos la cotización en DB para esa fecha exacta
  const exactMatch = await prisma.exchangeRate.findFirst({
    where: {
      source: SOURCE_BCRA,
      fromCurrency: "USD",
      toCurrency: "ARS",
      observedAt: targetDate,
    },
  });

  if (exactMatch) {
    return {
      date: requestedDateStr,
      observedAt: formatDate(exactMatch.observedAt),
      value: exactMatch.value.toFixed(6),
      source: SOURCE_BCRA,
      rateType: exactMatch.rateType,
    };
  }

  // 2. Si la fecha solicitada es fin de semana (sábado o domingo), verificar si ya tenemos el viernes hábil previo
  const precedingFriday = getPrecedingFriday(targetDate);
  if (precedingFriday.getTime() !== targetDate.getTime()) {
    const fridayMatch = await prisma.exchangeRate.findFirst({
      where: {
        source: SOURCE_BCRA,
        fromCurrency: "USD",
        toCurrency: "ARS",
        observedAt: precedingFriday,
      },
    });

    if (fridayMatch) {
      return {
        date: requestedDateStr,
        observedAt: formatDate(fridayMatch.observedAt),
        value: fridayMatch.value.toFixed(6),
        source: SOURCE_BCRA,
        rateType: fridayMatch.rateType,
      };
    }
  }

  // 3. Consultar API oficial del BCRA (ventana de 10 días hacia atrás)
  const hastaStr = targetDateStr;
  const desdeStr = formatDate(subDays(targetDate, 10));

  try {
    const bcraResults = await fetchFromBcra("USD", desdeStr, hastaStr);
    if (bcraResults.length > 0) {
      await persistRates(bcraResults, "USD", RATE_TYPE_ESTADISTICAS);
      const matched = extractMatchingRate(
        bcraResults,
        "USD",
        targetDateStr,
        requestedDateStr,
        RATE_TYPE_ESTADISTICAS,
      );
      if (matched) return matched;
    }
  } catch (error) {
    console.warn("Fallo al consultar la serie USD de la API del BCRA:", (error as Error).message);
  }

  // 4. Fallback a la serie de respaldo REF (Comunicación A 3500)
  try {
    const refResults = await fetchFromBcra("REF", desdeStr, hastaStr);
    if (refResults.length > 0) {
      await persistRates(refResults, "REF", RATE_TYPE_REF);
      const matched = extractMatchingRate(
        refResults,
        "REF",
        targetDateStr,
        requestedDateStr,
        RATE_TYPE_REF,
      );
      if (matched) return matched;
    }
  } catch (error) {
    console.warn("Fallo al consultar la serie de respaldo REF de la API del BCRA:", (error as Error).message);
  }

  // 5. Fallback a la última cotización guardada en base de datos
  const latestCached = await prisma.exchangeRate.findFirst({
    where: {
      source: SOURCE_BCRA,
      fromCurrency: "USD",
      toCurrency: "ARS",
      observedAt: { lte: targetDate },
    },
    orderBy: { observedAt: "desc" },
  });

  if (latestCached) {
    return {
      date: requestedDateStr,
      observedAt: formatDate(latestCached.observedAt),
      value: latestCached.value.toFixed(6),
      source: SOURCE_BCRA,
      rateType: latestCached.rateType,
    };
  }

  // 6. Si la base de datos está vacía y la API del BCRA no responde, informar sin voltear la app
  throw new AppError(
    503,
    "La cotización del BCRA no se encuentra disponible temporalmente. Por favor ingrese el valor manualmente.",
  );
}
