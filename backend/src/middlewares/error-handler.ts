import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/error.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        // Los campos extra van primero: no pueden pisar `error` ni `details`.
        res.status(err.statusCode).json({ ...err.extra, error: err.message, details: err.details });
        return;
    }

    if (err?.type === "entity.parse.failed") {
        res.status(400).json({ error: "invalid JSON" });
        return;
    }

    if (err?.type === "entity.too.large") {
        res.status(413).json({ error: "Payload too large" });
        return;
    }

    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
}