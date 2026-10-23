import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    category: {
      createMany: vi.fn(),
    },
    pointOfSale: {
      create: vi.fn(),
    },
    transaction: {
      count: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

describe("Organizations module (Onboarding & Settings / Issue #75)", () => {
  const userId = 42;
  const token = jwt.sign({}, env.JWT_SECRET, { subject: String(userId) });
  // CUIT válido: 20404812026 (módulo 11 válido)
  const validCuit = "20404812026";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/organizations (Onboarding)", () => {
    it("debe retornar 401 si no hay token", async () => {
      const res = await request(app).post("/api/organizations").send({ legalName: "Test" });
      expect(res.status).toBe(401);
    });

    it("debe crear la organización, categorías por defecto y punto de venta N° 1 retornando 201", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
      const mockCreatedOrg = {
        id: 10,
        userId,
        cuit: validCuit,
        legalName: "Brian Tech SAS",
        baseCurrency: "ARS",
        taxCondition: "MONOTRIBUTO",
      };
      vi.mocked(prisma.organization.create).mockResolvedValue(mockCreatedOrg as any);

      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${token}`)
        .send({
          cuit: validCuit,
          legalName: "Brian Tech SAS",
          baseCurrency: "ARS",
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockCreatedOrg);
      expect(prisma.organization.create).toHaveBeenCalled();
      expect(prisma.category.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ name: "Cobro de facturas", type: "INCOME" }),
          expect.objectContaining({ name: "Ventas", type: "INCOME" }),
          expect.objectContaining({ name: "Alquiler", type: "EXPENSE" }),
        ]),
      });
      expect(prisma.pointOfSale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ number: 1, billingMethod: "CAE" }),
      });
    });

    it("debe retornar 409 si el usuario ya tiene organización", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({ id: 1 } as any);

      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${token}`)
        .send({
          cuit: validCuit,
          legalName: "Brian Tech SAS",
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("Organization already exists");
    });

    it("debe retornar 400 con CUIT inválido", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${token}`)
        .send({
          cuit: "20123456789", // CUIT con dígito verificador inválido
          legalName: "Brian Tech SAS",
        });

      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe("cuit");
    });
  });

  describe("GET /api/organizations/me", () => {
    it("debe retornar la organización del usuario logueado", async () => {
      const mockOrg = { id: 10, userId, legalName: "Brian Tech SAS" };
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(mockOrg as any);

      const res = await request(app)
        .get("/api/organizations/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockOrg);
    });

    it("debe retornar 404 si el usuario no tiene organización", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/organizations/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/organizations/me", () => {
    it("debe rechazar cambiar la moneda base si ya existen movimientos con 409", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: 10,
        userId,
        baseCurrency: "ARS",
      } as any);
      vi.mocked(prisma.transaction.count).mockResolvedValue(5);

      const res = await request(app)
        .patch("/api/organizations/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ baseCurrency: "USD" });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("movimientos");
    });
  });
});
