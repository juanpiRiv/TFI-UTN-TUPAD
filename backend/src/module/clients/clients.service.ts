import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { Prisma } from "../../generated/prisma/client.js";
import type {
  CreateClientInput,
  UpdateClientInput,
  ListClientsQuery,
} from "./clients.schemas.js";

/**
 * Obtiene el ID de la organización asociada a un usuario autenticado.
 */
export async function getOrganizationIdByUserId(userId: number): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!org) {
    throw new AppError(404, "Organization not found for this user");
  }

  return org.id;
}

/**
 * Lista los clientes de una organización.
 * Por defecto filtra los dados de baja lógica (isActive: false), salvo que includeInactive sea true.
 * Permite buscar por nombre, documento o email.
 */
export async function listClients(
  organizationId: number,
  query?: ListClientsQuery,
) {
  const where: Prisma.ClientWhereInput = {
    organizationId,
  };

  if (!query?.includeInactive) {
    where.isActive = true;
  }

  if (query?.search && query.search.trim() !== "") {
    const term = query.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { docNumber: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ];
  }

  return prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
  });
}

/**
 * Obtiene un cliente por su ID verificando pertenencia a la organización.
 */
export async function getClientById(organizationId: number, id: number) {
  const client = await prisma.client.findFirst({
    where: {
      id,
      organizationId,
    },
  });

  if (!client) {
    throw new AppError(404, "Client not found");
  }

  return client;
}

/**
 * Crea un nuevo cliente dentro de la organización.
 * Valida unicidad de documento si docType y docNumber están presentes.
 */
export async function createClient(
  organizationId: number,
  data: CreateClientInput,
) {
  if (data.docType && data.docNumber) {
    const existing = await prisma.client.findFirst({
      where: {
        organizationId,
        docType: data.docType,
        docNumber: data.docNumber,
      },
    });

    if (existing) {
      throw new AppError(409, "Client document already registered");
    }
  }

  try {
    return await prisma.client.create({
      data: {
        organizationId,
        name: data.name.trim(),
        docType: data.docType ?? null,
        docNumber: data.docNumber ? data.docNumber.trim() : null,
        address: data.address ? data.address.trim() : null,
        taxCondition: data.taxCondition ?? null,
        email: data.email ? data.email.trim() : null,
        phone: data.phone ? data.phone.trim() : null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(409, "Client document already registered");
    }
    throw error;
  }
}

/**
 * Actualiza los datos de un cliente (o realiza baja/alta lógica con isActive).
 * No borra físicamente el registro.
 */
export async function updateClient(
  organizationId: number,
  id: number,
  data: UpdateClientInput,
) {
  const existing = await prisma.client.findFirst({
    where: {
      id,
      organizationId,
    },
  });

  if (!existing) {
    throw new AppError(404, "Client not found");
  }

  const targetDocType =
    data.docType !== undefined ? data.docType : existing.docType;
  const targetDocNumber =
    data.docNumber !== undefined
      ? data.docNumber ? data.docNumber.trim() : null
      : existing.docNumber;

  if (targetDocType && targetDocNumber) {
    const duplicate = await prisma.client.findFirst({
      where: {
        organizationId,
        docType: targetDocType,
        docNumber: targetDocNumber,
        id: { not: id },
      },
    });

    if (duplicate) {
      throw new AppError(409, "Client document already registered");
    }
  }

  const updateData: Prisma.ClientUncheckedUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.docType !== undefined) updateData.docType = data.docType;
  if (data.docNumber !== undefined)
    updateData.docNumber = data.docNumber ? data.docNumber.trim() : null;
  if (data.address !== undefined)
    updateData.address = data.address ? data.address.trim() : null;
  if (data.taxCondition !== undefined) updateData.taxCondition = data.taxCondition;
  if (data.email !== undefined)
    updateData.email = data.email ? data.email.trim() : null;
  if (data.phone !== undefined)
    updateData.phone = data.phone ? data.phone.trim() : null;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  try {
    return await prisma.client.update({
      where: { id },
      data: updateData,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(409, "Client document already registered");
    }
    throw error;
  }
}
