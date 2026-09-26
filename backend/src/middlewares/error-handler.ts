import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/error.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message, details: err.details });
        return;
    }

    // JSON mal formado en el body
    if (err?.type === "entity.parse.failed") {
        res.status(400).json({ error: "JSON inválido" });
        return;
    }

    // Violación de un unique en Prisma (p. ej. un CUIT ya registrado)
    if (err?.code === "P2002") {
        res.status(409).json({ error: "Ya existe un registro con esos datos" });
        return;
    }

    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
};