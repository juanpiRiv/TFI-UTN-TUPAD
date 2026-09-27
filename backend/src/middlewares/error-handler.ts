import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/error.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message, details: err.details });
        return;
    }

    if (err?.type === "entity.parse.failed") {
        res.status(400).json({ error: "invalid JSON" });
        return;
    }

    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
}