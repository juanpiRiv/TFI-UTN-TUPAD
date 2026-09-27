import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../lib/error.js';

export const validateBody = (schema: ZodType): RequestHandler =>
    (req, _res, next) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            const details = result.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
            }));
            throw new AppError(400, "invalid Data", details);
        }
        req.body = result.data;
        next();
    }