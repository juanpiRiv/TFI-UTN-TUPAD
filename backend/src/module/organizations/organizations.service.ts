import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { getUserOrganization } from "../../lib/organizations.js";
import { env } from "../../config/env.js";
import { evictOrganizationProviders } from "../arca/provider-cache.js";
import { isPlatformCuit, isPlatformOwnerEmail } from "../arca/platform-owner.js";
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

function prismaErrorCode(error: unknown): string | null {
    return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

const cuitTaken = () =>
    new AppError(409, "Ese CUIT ya está registrado en otra organización", [
        { field: "cuit", message: "Ese CUIT ya está registrado en otra organización" },
    ]);

/** Saca las claves undefined: Prisma no las acepta con exactOptionalPropertyTypes. */
function definedOnly<T extends object>(input: T) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
    ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

/**
 * El CUIT de la plataforma (ARCA_CUIT) es el del certificado con el que se firma: si cualquiera pudiera registrarlo,
 * emitiría con él. Se rechaza con el mismo error que un CUIT ocupado, para no revelar nada, salvo a los dueños
 * (ARCA_PLATFORM_OWNER_EMAILS).
 */
async function ensureNotPlatformCuit(tx: Prisma.TransactionClient, userId: number, cuit: string) {
    if (!isPlatformCuit(env, cuit)) return;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user && !isPlatformOwnerEmail(env, user.email)) {
        throw cuitTaken();
    }
}

async function ensureCuitAvailable(
    tx: Prisma.TransactionClient,
    cuit: string,
    exceptOrganizationId?: number,
) {
    const taken = await tx.organization.findFirst({
        where: {
            cuit,
            ...(exceptOrganizationId !== undefined && { NOT: { id: exceptOrganizationId } }),
        },
        select: { id: true },
    });
    if (taken) {
        throw cuitTaken();
    }
}

export async function createOrganization(userId: number, input: CreateOrganizationInput) {
    try {
        // Todo en una transacción: organización, categorías por defecto, punto de venta N° 1 y auditoría
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.organization.findUnique({
                where: { userId },
                select: { id: true },
            });
            if (existing) {
                throw new AppError(409, "Ya tenés una organización creada");
            }
            await ensureNotPlatformCuit(tx, userId, input.cuit);
            await ensureCuitAvailable(tx, input.cuit);

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

            // Punto de venta N° 1: sin uno no se puede crear ninguna factura. El número real del punto de
            // venta habilitado en ARCA se carga después (#27).
            await tx.pointOfSale.create({
                data: { organizationId: organization.id, number: 1, billingMethod: "CAE" },
            });

            // RNF-08
            await tx.auditLog.create({
                data: {
                    organizationId: organization.id,
                    userId,
                    action: "organization.created",
                    entity: "Organization",
                    entityId: organization.id,
                    metadata: { cuit: organization.cuit },
                },
            });

            return organization;
        });
    } catch (error) {
        const code = prismaErrorCode(error);
        if (code === "P2002") {
            // Dos pedidos simultáneos pasaron los chequeos: el unique de la base decide cuál falló
            const sameUser = await prisma.organization.findUnique({
                where: { userId },
                select: { id: true },
            });
            throw sameUser ? new AppError(409, "Ya tenés una organización creada") : cuitTaken();
        }
        if (code === "P2003") {
            // El token es válido pero el usuario ya no existe
            throw new AppError(401, "User not found");
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
    const data = definedOnly(input);

    let cuitChanged = false;
    try {
        // Chequeos y update en la misma transacción
        const updated = await prisma.$transaction(async (tx) => {
            const current = await tx.organization.findUniqueOrThrow({ where: { id } });

            if (data.cuit !== undefined && data.cuit !== current.cuit) {
                // El CUIT es el emisor de los comprobantes: con facturas autorizadas ya no se cambia
                const authorizedInvoices = await tx.invoice.count({
                    where: { organizationId: id, status: "AUTHORIZED" },
                });
                if (authorizedInvoices > 0) {
                    throw new AppError(409, "CUIT cannot change after issuing authorized invoices", [
                        { field: "cuit", message: "CUIT cannot change after issuing authorized invoices" },
                    ]);
                }
                await ensureNotPlatformCuit(tx, userId, data.cuit);
                await ensureCuitAvailable(tx, data.cuit, id);
                // La delegación se verificó para el CUIT anterior: con otro CUIT hay que volver a verificar.
                await tx.arcaDelegation.deleteMany({ where: { organizationId: id } });
                cuitChanged = true;
            }

            const organization = await tx.organization.update({ where: { id }, data });

            // RNF-08: se registran los campos modificados, no sus valores
            await tx.auditLog.create({
                data: {
                    organizationId: id,
                    userId,
                    action: "organization.updated",
                    entity: "Organization",
                    entityId: id,
                    metadata: { fields: Object.keys(data) },
                },
            });

            return organization;
        });
        // Fuera de la transacción confirmada: ningún cliente armado para el CUIT anterior se sigue usando.
        if (cuitChanged) evictOrganizationProviders(id);
        return updated;
    } catch (error) {
        if (prismaErrorCode(error) === "P2002") {
            throw cuitTaken();
        }
        throw error;
    }
}