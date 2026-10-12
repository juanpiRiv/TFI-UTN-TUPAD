import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import * as clientsService from "./clients.service.js";
import {
  createClientSchema,
  updateClientSchema,
  listClientsQuerySchema,
} from "./clients.schemas.js";

/**
 * GET /api/clients
 * Lista clientes de la organización con filtros opcionales (search, includeInactive).
 */
export async function list(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const queryResult = listClientsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    const details = queryResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid query parameters", details);
  }

  const organizationId = await clientsService.getOrganizationIdByUserId(req.userId);
  const clients = await clientsService.listClients(organizationId, queryResult.data);
  res.json(clients);
}

/**
 * GET /api/clients/:id
 * Obtiene el detalle de un cliente por ID.
 */
export async function getById(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "Invalid client ID");
  }

  const organizationId = await clientsService.getOrganizationIdByUserId(req.userId);
  const client = await clientsService.getClientById(organizationId, id);
  res.json(client);
}

/**
 * POST /api/clients
 * Crea un nuevo cliente. Retorna 201 Created.
 */
export async function create(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const bodyResult = createClientSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const details = bodyResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid data", details);
  }

  const organizationId = await clientsService.getOrganizationIdByUserId(req.userId);
  const client = await clientsService.createClient(organizationId, bodyResult.data);
  res.status(201).json(client);
}

/**
 * PATCH /api/clients/:id
 * Actualiza un cliente existente o aplica baja/alta lógica (isActive: false).
 */
export async function update(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "Invalid client ID");
  }

  const bodyResult = updateClientSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const details = bodyResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid data", details);
  }

  const organizationId = await clientsService.getOrganizationIdByUserId(req.userId);
  const client = await clientsService.updateClient(organizationId, id, bodyResult.data);
  res.json(client);
}
