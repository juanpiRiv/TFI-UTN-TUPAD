import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

// Valores falsos: la base está mockeada, pero config/env.ts exige las variables al importar la app.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET ??= "test-secret-solo-para-tests-0000000";
});

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("Categories module (CRUD / Issue #75)", () => {
  const userId = 10;
  const orgId = 5;
  const token = jwt.sign({}, env.JWT_SECRET, { subject: String(userId) });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      userId,
    } as any);
  });

  describe("GET /api/categories", () => {
    it("debe retornar 401 si no hay token", async () => {
      const res = await request(app).get("/api/categories");
      expect(res.status).toBe(401);
    });

    it("debe listar categorías activas de la organización por defecto", async () => {
      const mockCategories = [
        { id: 1, organizationId: orgId, name: "Consultoría", type: "INCOME", isActive: true },
        { id: 2, organizationId: orgId, name: "Ventas", type: "INCOME", isActive: true },
      ];
      vi.mocked(prisma.category.findMany).mockResolvedValue(mockCategories as any);

      const res = await request(app)
        .get("/api/categories")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockCategories);
      expect(prisma.category.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId, isActive: true },
        orderBy: { name: "asc" },
      });
    });

    it("debe filtrar por tipo y permitir includeInactive=true", async () => {
      vi.mocked(prisma.category.findMany).mockResolvedValue([]);

      const res = await request(app)
        .get("/api/categories?type=EXPENSE&includeInactive=true")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(prisma.category.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId, type: "EXPENSE" },
        orderBy: { name: "asc" },
      });
    });
  });

  describe("POST /api/categories", () => {
    it("debe crear una categoría y retornar 201", async () => {
      vi.mocked(prisma.category.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.category.create).mockResolvedValue({
        id: 3,
        organizationId: orgId,
        name: "Hosting y Cloud",
        type: "EXPENSE",
        isActive: true,
      } as any);

      const res = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Hosting y Cloud", type: "EXPENSE" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Hosting y Cloud");
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId,
          name: "Hosting y Cloud",
          type: "EXPENSE",
          isActive: true,
        },
      });
    });

    it("debe retornar 409 si ya existe una categoría con ese nombre y tipo", async () => {
      vi.mocked(prisma.category.findUnique).mockResolvedValue({
        id: 1,
        name: "Ventas",
        type: "INCOME",
      } as any);

      const res = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Ventas", type: "INCOME" });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("Ya existe");
    });

    it("debe validar datos inválidos con 400", async () => {
      const res = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "", type: "INVALIDO" });

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/categories/:id", () => {
    it("debe rechazar modificar el tipo con 400", async () => {
      const res = await request(app)
        .patch("/api/categories/1")
        .set("Authorization", `Bearer ${token}`)
        .send({ type: "EXPENSE" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("tipo");
    });

    it("debe permitir modificar el nombre y dar de baja lógica", async () => {
      vi.mocked(prisma.category.findFirst).mockResolvedValue({
        id: 1,
        organizationId: orgId,
        name: "Antiguo",
        type: "INCOME",
        isActive: true,
      } as any);
      vi.mocked(prisma.category.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.category.update).mockResolvedValue({
        id: 1,
        name: "Nuevo Nombre",
        isActive: false,
      } as any);

      const res = await request(app)
        .patch("/api/categories/1")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Nuevo Nombre", isActive: false });

      expect(res.status).toBe(200);
      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: "Nuevo Nombre", isActive: false },
      });
    });

    it("debe retornar 404 si la categoría no pertenece a la organización", async () => {
      vi.mocked(prisma.category.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .patch("/api/categories/999")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Nuevo" });

      expect(res.status).toBe(404);
    });
  });
});
