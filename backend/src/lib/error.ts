export class AppError extends Error {
    readonly statusCode: number;
    readonly details: unknown;
    /** Campos extra estables que el handler vuelca tal cual en la respuesta (por ejemplo `code`, `missing`). */
    readonly extra: Record<string, unknown> | undefined;

    constructor(statusCode: number, message: string, details?: unknown, extra?: Record<string, unknown>) {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.details = details;
        this.extra = extra;
    }
}