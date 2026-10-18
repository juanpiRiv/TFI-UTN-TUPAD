import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { getUserOrganization } from "../../lib/organizations.js";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "./organizations.schemas.js";

// Categorías que se crean con la organización (docs/08-contrato-api.md).
// "Cobro de facturas" la usa el módulo de pagos para los ingresos de cada cobro.
const DEFAULT_CATEGORIES = [
    { name: "Cobro de facturas", type: "INCOME" },
    { name: "Ventas", type: "INCOME" },
    { name: "Otros ingresos", type: "INCOME" },
    { name: "Alquiler", type: "EXPENSE" },
    { name: "Servicios contratados", type: "EXPENSE" },
    { name: "Impuestos", type: "EXPENSE" },
    { name: "Otros egresos", type: "EXPENSE" },
] as const;

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function definedOnly<T extends object>(input: T) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
    ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

async function ensureCuitAvailable(cuit: string, exceptOrganizationId?: number) {
    const taken = await prisma.organization.findFirst({
        where: {
            cuit,
            ...(exceptOrganizationId !== undefined && { NOT: { id: exceptOrganizationId } }),
        },
        select: { id: true },
    });
    if (taken) {
        throw new AppError(409, "CUIT already registered", [
            { field: "cuit", message: "CUIT already registered" },
        ]);
    }
}

export async function createOrganization(userId: number, input: CreateOrganizationInput) {
    const existing = await prisma.organization.findUnique({
        where: { userId },
        select: { id: true },
    });
    if (existing) {
        throw new AppError(409, "Organization already exists");
    }
    await ensureCuitAvailable(input.cuit);

    try {
        // Organización y categorías por defecto juntas: si falla una, no queda ninguna
        return await prisma.$transaction(async (tx) => {
            const organization = await tx.organization.create({
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
                data: DEFAULT_CATEGORIES.map((category) => ({
                    ...category,
                    organizationId: organization.id,
                })),
            });

            return organization;
        });
    } catch (error) {
        // Dos pedidos simultáneos pueden pasar los chequeos de arriba: el unique de la base decide
        if (isUniqueViolation(error)) {
            throw new AppError(409, "Organization already exists or CUIT already registered");
        }
        throw error;
    }
}

export async function getOrganization(userId: number) {
    const { id } = await getUserOrganization(userId);
    return prisma.organization.findUniqueOrThrow({ where: { id } });
}

export async function updateOrganization(userId: number, input: UpdateOrganizationInput) {
    const { id } = await getUserOrganization(userId);
    const current = await prisma.organization.findUniqueOrThrow({ where: { id } });

    if (input.cuit !== undefined && input.cuit !== current.cuit) {
        // El CUIT es el emisor de los comprobantes: con facturas autorizadas ya no se cambia
        const authorizedInvoices = await prisma.invoice.count({
            where: { organizationId: id, status: "AUTHORIZED" },
        });
        if (authorizedInvoices > 0) {
            throw new AppError(409, "CUIT cannot change after issuing authorized invoices", [
                { field: "cuit", message: "CUIT cannot change after issuing authorized invoices" },
            ]);
        }
        await ensureCuitAvailable(input.cuit, id);
    }

    if (input.baseCurrency !== undefined && input.baseCurrency !== current.baseCurrency) {
        // Los tipos de cambio guardados son contra la moneda base (RN-06)
        const transactions = await prisma.transaction.count({ where: { organizationId: id } });
        if (transactions > 0) {
            throw new AppError(409, "Base currency cannot change once there are transactions", [
                { field: "baseCurrency", message: "Base currency cannot change once there are transactions" },
            ]);
        }
    }

    try {
        return await prisma.organization.update({ where: { id }, data: definedOnly(input) });
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new AppError(409, "CUIT already registered");
        }
        throw error;
    }
}