import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../lib/error.js";

export const requireAuth: RequestHandler = (req, _res, next) => {
    const [scheme, token] = req.headers.authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
        throw new AppError(401, "Missing token");
    }

    let userId: number;
    try {
        const payload = jwt.verify(token, env.JWT_SECRET);
        if (typeof payload === "string" || !payload.sub) throw new Error();
        userId = Number(payload.sub);
    } catch {
        throw new AppError(401, "Invalid Token");
    }

    req.userId = userId;
    next();
}