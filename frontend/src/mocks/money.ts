// Exact decimal math for the mocks, which stand in for the backend. The frontend itself never
// adds or converts money: it only formats the strings the API returns.

const CENTS = 100n
const RATE_SCALE = 1_000_000n

function parseScaled(value: string, decimals: number): bigint {
  const [integer = '0', fraction = ''] = value.split('.')
  return BigInt(integer + fraction.padEnd(decimals, '0').slice(0, decimals))
}

export function toCents(amount: string): bigint {
  return parseScaled(amount, 2)
}

export function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n
  const abs = negative ? -cents : cents
  const integer = abs / CENTS
  const fraction = String(abs % CENTS).padStart(2, '0')
  return `${negative ? '-' : ''}${integer}.${fraction}`
}

/** amount (2 decimals) * rate (6 decimals), rounded half up to cents. */
export function convertCents(amount: string, rate: string): bigint {
  const product = toCents(amount) * parseScaled(rate, 6)
  return (product + RATE_SCALE / 2n) / RATE_SCALE
}

export function formatRate(rate: string): string {
  const scaled = parseScaled(rate, 6)
  return `${scaled / RATE_SCALE}.${String(scaled % RATE_SCALE).padStart(6, '0')}`
}
