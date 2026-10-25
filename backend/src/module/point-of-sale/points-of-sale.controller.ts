import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import { listPointsOfSaleQuerySchema, pointOfSaleIdParamSchema } from "./points-of-sale.schemas.js";
import * as pointsOfSaleService from "./points-of-sale.service.js";

function parseId(req: Request): number {
    const result = pointOfSaleIdParamSchema.safeParse(req.params);
    if (!result.success) {
        throw new AppError(400, "Invalid point of sale id");
    }
    return result.data.id;
}

export async function list(req: Request, res: Response) {
    const query = listPointsOfSaleQuerySchema.safeParse(req.query);
    if (!query.success) {
        throw new AppError(400, "Invalid query parameters");
    }
    res.json(await pointsOfSaleService.listPointsOfSale(req.userId!, query.data));
}

export async function getById(req: Request, res: Response) {
    res.json(await pointsOfSaleService.getPointOfSale(req.userId!, parseId(req)));
}

export async function create(req: Request, res: Response) {
    const pointOfSale = await pointsOfSaleService.createPointOfSale(req.userId!, req.body);
    res.status(201).json(pointOfSale);
}

export async function update(req: Request, res: Response) {
    res.json(await pointsOfSaleService.updatePointOfSale(req.userId!, parseId(req), req.body));
}