import type { Request, Response } from "express";
import * as organizationsService from "./organizations.service.js";

export async function create(req: Request, res: Response) {
    const organization = await organizationsService.createOrganization(req.userId!, req.body);
    res.status(201).json(organization);
}

export async function getMine(req: Request, res: Response) {
    const organization = await organizationsService.getOrganization(req.organizationId!);
    res.json(organization);
}

export async function updateMine(req: Request, res: Response) {
    const organization = await organizationsService.updateOrganization(req.organizationId!, req.body);
    res.json(organization);
}