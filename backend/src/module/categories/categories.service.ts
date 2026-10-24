import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import type { MovementType } from "../../generated/prisma/client.js";
import type { CreateCategoryInput, UpdateCategoryInput, ListCategoriesQuery } from "./categories.schemas.js";

export async function listCategories(organizationId: number, query: ListCategoriesQuery) {
  const where: { organizationId: number; type?: MovementType; isActive?: boolean } = {
    organizationId,
  };

  if (query.type) {
    where.type = query.type;
  }

  if (!query.includeInactive) {
    where.isActive = true;
  }

  return prisma.category.findMany({
    where,
    orderBy: { name: "asc" },
  });
}

export async function createCategory(organizationId: number, input: CreateCategoryInput) {
  const existing = await prisma.category.findUnique({
    where: {
      organizationId_name_type: {
        organizationId,
        name: input.name,
        type: input.type,
      },
    },
  });

  if (existing) {
    throw new AppError(409, "Ya existe una categoría con ese nombre y tipo");
  }

  return prisma.category.create({
    data: {
      organizationId,
      name: input.name,
      type: input.type,
      isActive: true,
    },
  });
}

export async function updateCategory(
  organizationId: number,
  categoryId: number,
  input: UpdateCategoryInput,
) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, organizationId },
  });

  if (!category) {
    throw new AppError(404, "Categoría no encontrada");
  }

  if (input.name && input.name !== category.name) {
    const existing = await prisma.category.findUnique({
      where: {
        organizationId_name_type: {
          organizationId,
          name: input.name,
          type: category.type,
        },
      },
    });

    if (existing) {
      throw new AppError(409, "Ya existe una categoría con ese nombre y tipo");
    }
  }

  return prisma.category.update({
    where: { id: categoryId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}
