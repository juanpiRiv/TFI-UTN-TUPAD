import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { getUserOrganization } from "../../lib/organizations.js";
import type {
    CreatePointOfSaleInput,
    ListPointsOfSaleQuery,
    UpdatePointOfSaleInput,
} from "./points-of-sale.schemas.js";

/** Saca las claves undefined: Prisma no las acepta con exactOptionalPropertyTypes. */
function definedOnly<T extends object>(input: T) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
    ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function conflict(field: string, message: string) {
    return new AppError(409, message, [{ field, message }]);
}

const numberTaken = () =>
    conflict("number", "There is already a point of sale with that number");

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function ensureNumberAvailable(
    tx: Prisma.TransactionClient,
    organizationId: number,
    number: number,
    exceptId?: number,
) {
    const taken = await tx.pointOfSale.findFirst({
        where: {
            organizationId,
            number,
            ...(exceptId !== undefined && { NOT: { id: exceptId } }),
        },
        select: { id: true },
    });
    if (taken) {
        throw numberTaken();
    }
}

export async function listPointsOfSale(userId: number, query: ListPointsOfSaleQuery) {
    const { id: organizationId } = await getUserOrganization(userId);
    return prisma.pointOfSale.findMany({
        where: { organizationId, ...(!query.includeInactive && { isActive: true }) },
        orderBy: { number: "asc" },
    });
}

export async function getPointOfSale(userId: number, id: number) {
    const { id: organizationId } = await getUserOrganization(userId);
    // Busca siempre dentro de la organización: si es de otra, responde 404
    const pointOfSale = await prisma.pointOfSale.findFirst({ where: { id, organizationId } });
    if (!pointOfSale) {
        throw new AppError(404, "Point of sale not found");
    }
    return pointOfSale;
}

export async function createPointOfSale(userId: number, input: CreatePointOfSaleInput) {
    const { id: organizationId } = await getUserOrganization(userId);

    try {
        return await prisma.$transaction(async (tx) => {
            await ensureNumberAvailable(tx, organizationId, input.number);

            const pointOfSale = await tx.pointOfSale.create({
                data: { organizationId, number: input.number, address: input.address ?? null },
            });

            // RNF-08
            await tx.auditLog.create({
                data: {
                    organizationId,
                    userId,
                    action: "point_of_sale.created",
                    entity: "PointOfSale",
                    entityId: pointOfSale.id,
                    metadata: { number: pointOfSale.number },
                },
            });

            return pointOfSale;
        });
    } catch (error) {
        // Dos pedidos simultáneos con el mismo número: el unique de la base decide
        if (isUniqueViolation(error)) throw numberTaken();
        throw error;
    }
}

export async function updatePointOfSale(
    userId: number,
    id: number,
    input: UpdatePointOfSaleInput,
) {
    const { id: organizationId } = await getUserOrganization(userId);
    const data = definedOnly(input);

    try {
        return await prisma.$transaction(async (tx) => {
            const current = await tx.pointOfSale.findFirst({ where: { id, organizationId } });
            if (!current) {
                throw new AppError(404, "Point of sale not found");
            }

            if (data.number !== undefined && data.number !== current.number) {
                // Las facturas numeran por punto de venta: si ya tiene facturas, el número queda fijo
                const invoices = await tx.invoice.count({ where: { pointOfSaleId: id } });
                if (invoices > 0) {
                    throw conflict("number", "The number cannot change once the point of sale has invoices");
                }
                await ensureNumberAvailable(tx, organizationId, data.number, id);
            }

            if (data.isActive === false && current.isActive) {
                // Las facturas nuevas usan el primer punto de venta activo: siempre tiene que quedar uno
                const otherActive = await tx.pointOfSale.count({
                    where: { organizationId, isActive: true, NOT: { id } },
                });
                if (otherActive === 0) {
                    throw conflict("isActive", "There must be at least one active point of sale");
                }
            }

            const pointOfSale = await tx.pointOfSale.update({ where: { id }, data });

            await tx.auditLog.create({
                data: {
                    organizationId,
                    userId,
                    action: "point_of_sale.updated",
                    entity: "PointOfSale",
                    entityId: id,
                    metadata: { fields: Object.keys(data) },
                },
            });

            return pointOfSale;
        });
    } catch (error) {
        if (isUniqueViolation(error)) throw numberTaken();
        throw error;
    }
}