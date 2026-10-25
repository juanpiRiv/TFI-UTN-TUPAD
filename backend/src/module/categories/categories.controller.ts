import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import { prisma } from "../../lib/prisma.js";
import {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesQuerySchema,
} from "./categories.schemas.js";
import * as categoriesService from "./categories.service.js";

async function getOrganizationId(userId: number): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!org) {
    throw new AppError(404, "Organization not found for this user");
  }

  return org.id;
}

export async function list(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const queryResult = listCategoriesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    const details = queryResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid query parameters", details);
  }

  const organizationId = await getOrganizationId(req.userId);
  const categories = await categoriesService.listCategories(organizationId, queryResult.data);
  res.json(categories);
}

export async function create(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid category data", details);
  }

  const organizationId = await getOrganizationId(req.userId);
  const category = await categoriesService.createCategory(organizationId, parsed.data);
  res.status(201).json(category);
}

export async function update(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "Invalid category ID");
  }

  if (req.body && "type" in req.body) {
    throw new AppError(400, "No se puede cambiar el tipo de una categoría");
  }

  const parsed = updateCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid category data", details);
  }

  const organizationId = await getOrganizationId(req.userId);
  const category = await categoriesService.updateCategory(organizationId, id, parsed.data);
  res.json(category);
}
