import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/error.js";
import type { ExchangeRateDto } from "./exchange-rates.schemas.js";

const BCRA_BASE_URL = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones";
const SOURCE_BCRA = "BCRA";
export const RATE_TYPE_ESTADISTICAS = "ESTADISTICAS_CAMBIARIAS";
export const RATE_TYPE_REF = "COM_A_3500";
const REQUEST_TIMEOUT_MS = 4000; // Timeout reducido a 4s para no demorar requests del usuario
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos de espera para intentos vacíos o fallidos
const MAX_LOOKBACK_DAYS = 30; // Límite de antigüedad para el fallback en DB

// Caché en memoria para evitar reintentar consultas al BCRA que devolvieron vacío o fallaron en feriados/días sin publicación
const emptyAttempts = new Map<string, number>();

function isNegativeCached(currencyCode: "USD" | "REF", targetDateStr: string): boolean {
  const key = `${currencyCode}:${targetDateStr}`;
  const expiresAt = emptyAttempts.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    emptyAttempts.delete(key);
    return false;
  }
  return true;
}

function setNegativeCache(currencyCode: "USD" | "REF", targetDateStr: string): void {
  const key = `${currencyCode}:${targetDateStr}`;
  emptyAttempts.set(key, Date.now() + NEGATIVE_CACHE_TTL_MS);
}

export function clearNegativeCache(): void {
  emptyAttempts.clear();
}

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

/**
 * Obtiene la fecha actual en la zona horaria de Argentina (UTC-3),
 * evitando desfasajes entre las 21:00 y las 24:00 respecto a UTC.
 */
function getArgentinaTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
 * Persiste las cotizaciones obtenidas del BCRA en la base de datos (cache)
 * en un único lote transaccional usando prisma.$transaction.
 */
async function persistRates(
  items: BcraItem[],
  currencyCode: "USD" | "REF",
  rateType: string,
): Promise<void> {
  const ops = [];
  for (const item of items) {
    const detail = item.detalle.find((d) => d.codigoMoneda === currencyCode) ?? item.detalle[0];
    if (!detail || typeof detail.tipoCotizacion !== "number" || isNaN(detail.tipoCotizacion)) {
      continue;
    }

    const observedAt = parseUtcDate(item.fecha);
    const value = new Prisma.Decimal(detail.tipoCotizacion.toFixed(6));

    ops.push(
      prisma.exchangeRate.upsert({
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
      }),
    );
  }

  if (ops.length > 0) {
    await prisma.$transaction(ops);
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
 * Busca en DB la cotización para una fecha específica,
 * priorizando siempre la cotización de gestión (Estadísticas Cambiarias) antes de la de referencia (REF).
 */
async function findCachedRateForDate(observedAt: Date) {
  const estMatch = await prisma.exchangeRate.findFirst({
    where: {
      source: SOURCE_BCRA,
      rateType: RATE_TYPE_ESTADISTICAS,
      fromCurrency: "USD",
      toCurrency: "ARS",
      observedAt,
    },
  });
  if (estMatch) return estMatch;

  return prisma.exchangeRate.findFirst({
    where: {
      source: SOURCE_BCRA,
      rateType: RATE_TYPE_REF,
      fromCurrency: "USD",
      toCurrency: "ARS",
      observedAt,
    },
  });
}

/**
 * Busca la cotización más reciente en DB menor o igual a targetDate,
 * con límite de antigüedad (minObservedAt) y priorizando Estadísticas Cambiarias.
 */
async function findLatestCachedRate(targetDate: Date, minObservedAt: Date) {
  const latestEst = await prisma.exchangeRate.findFirst({
    where: {
      source: SOURCE_BCRA,
      rateType: RATE_TYPE_ESTADISTICAS,
      fromCurrency: "USD",
      toCurrency: "ARS",
      observedAt: {
        lte: targetDate,
        gte: minObservedAt,
      },
    },
    orderBy: { observedAt: "desc" },
  });
  if (latestEst) return latestEst;

  return prisma.exchangeRate.findFirst({
    where: {
      source: SOURCE_BCRA,
      rateType: RATE_TYPE_REF,
      fromCurrency: "USD",
      toCurrency: "ARS",
      observedAt: {
        lte: targetDate,
        gte: minObservedAt,
      },
    },
    orderBy: { observedAt: "desc" },
  });
}

/**
 * Obtiene la cotización del dólar (USD a ARS) para la fecha solicitada.
 * Aplica estrategia de caché en base de datos, consulta al BCRA con ventana histórica de 10 días,
 * resolución del último día hábil anterior o igual a la fecha, caché negativo para no saturar en feriados,
 * y fallback ordenado con límite de antigüedad.
 */
export async function getUsdExchangeRate(requestedDateStr: string): Promise<ExchangeRateDto> {
  const requestedDate = parseUtcDate(requestedDateStr);
  const todayStr = getArgentinaTodayStr();

  // El BCRA rechaza fechas futuras con 400. Si piden fecha futura, se acota a hoy (en horario argentino).
  const targetDateStr = requestedDateStr > todayStr ? todayStr : requestedDateStr;
  const targetDate = parseUtcDate(targetDateStr);

  // 1. Revisar si ya tenemos la cotización en DB para esa fecha exacta (priorizando Estadísticas Cambiarias)
  const exactMatch = await findCachedRateForDate(targetDate);
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
    const fridayMatch = await findCachedRateForDate(precedingFriday);
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

  if (!isNegativeCached("USD", targetDateStr)) {
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
      } else {
        setNegativeCache("USD", targetDateStr);
      }
    } catch (error) {
      setNegativeCache("USD", targetDateStr);
      console.warn("Fallo al consultar la serie USD de la API del BCRA:", (error as Error).message);
    }
  }

  // 4. Fallback a la serie de respaldo REF (Comunicación A 3500)
  if (!isNegativeCached("REF", targetDateStr)) {
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
      } else {
        setNegativeCache("REF", targetDateStr);
      }
    } catch (error) {
      setNegativeCache("REF", targetDateStr);
      console.warn("Fallo al consultar la serie de respaldo REF de la API del BCRA:", (error as Error).message);
    }
  }

  // 5. Fallback a la última cotización guardada en base de datos con límite de antigüedad (30 días)
  const minObservedAt = subDays(targetDate, MAX_LOOKBACK_DAYS);
  const latestCached = await findLatestCachedRate(targetDate, minObservedAt);

  if (latestCached) {
    return {
      date: requestedDateStr,
      observedAt: formatDate(latestCached.observedAt),
      value: latestCached.value.toFixed(6),
      source: SOURCE_BCRA,
      rateType: latestCached.rateType,
    };
  }

  // 6. Si la base de datos no tiene cotizaciones recientes y la API del BCRA no responde, informar sin voltear la app
  throw new AppError(
    503,
    "La cotización del BCRA no se encuentra disponible temporalmente. Por favor ingrese el valor manualmente.",
  );
}

export interface ResolvedExchangeRate {
  value: Prisma.Decimal;
  source: "BCRA" | "MANUAL";
  observedAt?: string;
  rateType?: string;
}

/**
 * Cuenta la cantidad de días hábiles transcurridos entre dos fechas YYYY-MM-DD (excluye fines de semana).
 */
export function countBusinessDays(fromStr: string, toStr: string): number {
  if (fromStr >= toStr) return 0;
  const cur = new Date(`${fromStr}T00:00:00.000Z`);
  const end = new Date(`${toStr}T00:00:00.000Z`);
  let count = 0;
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
  }
  return count;
}

/**
 * Valida que el tipo de cambio manual se encuentre dentro de un rango razonable (P2).
 */
function validateExchangeRateBounds(currency: string, baseCurrency: string, rate: Prisma.Decimal): void {
  if (currency === "USD" && baseCurrency === "ARS") {
    if (rate.lt(1) || rate.gt(100000)) {
      throw new AppError(400, "El tipo de cambio para USD/ARS debe estar en un rango razonable (entre 1 y 100000)");
    }
    return;
  }

  if (rate.lt("0.0001") || rate.gt("10000000")) {
    throw new AppError(400, "Tipo de cambio fuera de los límites permitidos");
  }
}

export const exchangeRatesService = {
  getUsdExchangeRate,
  resolveExchangeRate,
};

/**
 * Resuelve el tipo de cambio para un movimiento o pago (función compartida - Issue #37):
 * - Si currency === baseCurrency -> retorna null.
 * - Si se envía manualRate -> valida cotas y retorna MANUAL.
 * - Si es USD con base ARS y sin manualRate -> consulta BCRA, verifica que no tenga más de 5 días hábiles
 *   de antigüedad respecto a la fecha del movimiento y propaga 503 si el servicio no está disponible.
 * - En cualquier otro caso sin tipo de cambio -> lanza 400.
 */
export async function resolveExchangeRate(
  currency: string,
  baseCurrency: string,
  transactionDate: string,
  manualRate?: string | null,
): Promise<ResolvedExchangeRate | null> {
  if (currency === baseCurrency) {
    return null;
  }

  if (manualRate) {
    const dec = new Prisma.Decimal(manualRate);
    validateExchangeRateBounds(currency, baseCurrency, dec);
    return {
      value: dec,
      source: "MANUAL",
    };
  }

  if (currency === "USD" && baseCurrency === "ARS") {
    try {
      const rateDto = await exchangeRatesService.getUsdExchangeRate(transactionDate);

      // P1: Comparar observedAt con transactionDate: si pasan más de 5 días hábiles, pedir cambio manual
      const businessDaysDiff = countBusinessDays(rateDto.observedAt, transactionDate);
      if (businessDaysDiff > 5) {
        throw new AppError(
          400,
          `La cotización oficial disponible (${rateDto.observedAt}) tiene más de 5 días hábiles de antigüedad respecto a la fecha del movimiento (${transactionDate}). Por favor ingrese el tipo de cambio manualmente.`,
        );
      }

      return {
        value: new Prisma.Decimal(rateDto.value),
        source: "BCRA",
        observedAt: rateDto.observedAt,
        rateType: rateDto.rateType,
      };
    } catch (error) {
      console.warn("No se pudo obtener la cotización automática del BCRA:", (error as Error).message);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        503,
        "La cotización del BCRA no se encuentra disponible temporalmente. Por favor ingrese el tipo de cambio manualmente.",
      );
    }
  }

  throw new AppError(400, "Exchange rate is required for this currency");
}
