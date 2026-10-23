import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import { createOrganizationSchema, updateOrganizationSchema } from "./organizations.schemas.js";
import * as orgService from "./organizations.service.js";

export async function create(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const parsed = createOrganizationSchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid organization data", details);
  }

  const organization = await orgService.createOrganization(req.userId, parsed.data);
  res.status(201).json(organization);
}

export async function getMe(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const organization = await orgService.getOrganizationByUserId(req.userId);
  res.json(organization);
}

export async function updateMe(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const parsed = updateOrganizationSchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid organization data", details);
  }

  const organization = await orgService.updateOrganization(req.userId, parsed.data);
  res.json(organization);
}
