import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "./organizations.schemas.js";

// Categorías iniciales por defecto según docs/08
export const DEFAULT_CATEGORIES = [
  { name: "Cobro de facturas", type: "INCOME" as const },
  { name: "Ventas", type: "INCOME" as const },
  { name: "Otros ingresos", type: "INCOME" as const },
  { name: "Alquiler", type: "EXPENSE" as const },
  { name: "Servicios contratados", type: "EXPENSE" as const },
  { name: "Impuestos", type: "EXPENSE" as const },
  { name: "Otros egresos", type: "EXPENSE" as const },
];

export async function createOrganization(userId: number, input: CreateOrganizationInput) {
  const existingUserOrg = await prisma.organization.findUnique({ where: { userId } });
  if (existingUserOrg) {
    throw new AppError(409, "Organization already exists for this user");
  }

  const existingCuit = await prisma.organization.findUnique({ where: { cuit: input.cuit } });
  if (existingCuit) {
    throw new AppError(409, "CUIT already registered");
  }

  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        userId,
        cuit: input.cuit,
        legalName: input.legalName,
        tradeName: input.tradeName ?? null,
        commercialAddress: input.commercialAddress ?? null,
        taxCondition: input.taxCondition,
        monotributoCategory: input.monotributoCategory ?? null,
        activityStartDate: input.activityStartDate ?? null,
        grossIncomeNumber: input.grossIncomeNumber ?? null,
        baseCurrency: input.baseCurrency,
      },
    });

    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((cat) => ({
        organizationId: org.id,
        name: cat.name,
        type: cat.type,
      })),
    });

    // Punto de venta N° 1 inicial
    await tx.pointOfSale.create({
      data: {
        organizationId: org.id,
        number: 1,
        billingMethod: "CAE",
        address: input.commercialAddress ?? null,
      },
    });

    return org;
  });

  return organization;
}

export async function getOrganizationByUserId(userId: number) {
  const org = await prisma.organization.findUnique({ where: { userId } });
  if (!org) {
    throw new AppError(404, "Organization not found for this user");
  }
  return org;
}

export async function updateOrganization(userId: number, input: UpdateOrganizationInput) {
  const org = await getOrganizationByUserId(userId);

  if (input.baseCurrency && input.baseCurrency !== org.baseCurrency) {
    const txCount = await prisma.transaction.count({ where: { organizationId: org.id } });
    if (txCount > 0) {
      throw new AppError(409, "No se puede cambiar la moneda base con movimientos registrados");
    }
  }

  const data: Prisma.OrganizationUpdateInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (data as any)[key] = value;
    }
  }

  return prisma.organization.update({
    where: { id: org.id },
    data,
  });
}
