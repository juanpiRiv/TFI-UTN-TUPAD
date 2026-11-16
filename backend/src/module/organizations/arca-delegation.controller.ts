import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import * as service from "../arca/arca-delegation.service.js";

export async function getStatus(req: Request, res: Response) {
    res.json(await service.getArcaDelegation(req.userId!, env));
}

export async function verify(req: Request, res: Response) {
    res.json(await service.verifyArcaDelegation(req.userId!, env));
}

export async function remove(req: Request, res: Response) {
    await service.deleteArcaDelegation(req.userId!);
    res.status(204).end();
}
