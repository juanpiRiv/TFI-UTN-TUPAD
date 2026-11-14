import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import * as arcaCredentialService from "../arca/arca-credential.service.js";

export async function getStatus(req: Request, res: Response) {
    res.json(await arcaCredentialService.getArcaCredentialStatus(req.userId!));
}

export async function save(req: Request, res: Response) {
    res.json(await arcaCredentialService.saveArcaCredential(req.userId!, req.body, env.ARCA_ENCRYPTION_KEY));
}

export async function remove(req: Request, res: Response) {
    await arcaCredentialService.deleteArcaCredential(req.userId!);
    res.status(204).end();
}
