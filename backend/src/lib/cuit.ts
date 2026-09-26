const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function isValidCuit(cuit: string): boolean {
    if (!/^\d{11}$/.test(cuit)) return false;

    const digits = cuit.split("").map(Number);
    const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i]!, 0);
    const mod = 11 - (sum % 11);
    const expected = mod === 11 ? 0 : mod === 10 ? 9 : mod;

    return expected === digits[10];
}