import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/error.js";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "./organizations.schemas.js";

// Categorías iniciales para registrar movimientos desde el primer día
const DEFAULT_CATEGORIES = [
    { name: "Ventas", type: "INCOME" },
    { name: "Servicios prestados", type: "INCOME" },
    { name: "Otros ingresos", type: "INCOME" },
    { name: "Monotributo", type: "EXPENSE" },
    { name: "Alquiler", type: "EXPENSE" },
    { name: "Servicios (luz, gas, internet)", type: "EXPENSE" },
    { name: "Insumos", type: "EXPENSE" },
    { name: "Transporte", type: "EXPENSE" },
    { name: "Comisiones bancarias", type: "EXPENSE" },
    { name: "Otros egresos", type: "EXPENSE" },
] as const;

export async function createOrganization(userId: number, input: CreateOrganizationInput) {
    const existing = await prisma.organization.findUnique({ where: { userId } });
    if (existing) {
        throw new AppError(409, "El usuario ya tiene una organización configurada");
    }

    const organization = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
            data: {
                ...input,
                userId,
                taxCondition: "MONOTRIBUTO",
            },
        });

        await tx.category.createMany({
            data: DEFAULT_CATEGORIES.map((category) => ({
                ...category,
                organizationId: created.id,
            })),
        });

        return created;
    });

    await recordAudit({
        action: "organization.created",
        userId,
        organizationId: organization.id,
        entity: "Organization",
        entityId: organization.id,
    });

    return organization;
}

export async function getOrganization(organizationId: number) {
    return prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
}

export async function updateOrganization(organizationId: number, input: UpdateOrganizationInput) {
    if (input.baseCurrency) {
        const current = await prisma.organization.findUniqueOrThrow({
            where: { id: organizationId },
            select: { baseCurrency: true },
        });

        if (input.baseCurrency !== current.baseCurrency) {
            const transactionCount = await prisma.transaction.count({ where: { organizationId } });
            if (transactionCount > 0) {
                throw new AppError(409, "No se puede cambiar la moneda base con movimientos registrados");
            }
        }
    }

    return prisma.organization.update({
        where: { id: organizationId },
        data: input,
    });
}