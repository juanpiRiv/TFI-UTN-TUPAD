import "dotenv/config";
import argon2 from "argon2";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("El seed no se puede ejecutar en producción");
    process.exit(1);
  }

  console.log("🌱 Iniciando seed de la base de datos...");

  // 1. Usuario de prueba para login
  const passwordHash = await argon2.hash("Password123!", {
    type: argon2.argon2id,
  });

  const user = await prisma.user.upsert({
    where: { email: "demo@monotributo.com" },
    update: {},
    create: {
      email: "demo@monotributo.com",
      name: "Juan Perez",
      passwordHash,
    },
  });
  console.log(`👤 Usuario de prueba listo: ${user.email} (password: Password123!)`);

  // 2. Organización (Monotributista)
  const organization = await prisma.organization.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      cuit: "20381234569",
      legalName: "Juan Perez Servicios Informáticos",
      tradeName: "JP Tech Solutions",
      commercialAddress: "Av. Corrientes 1234, CABA",
      taxCondition: "MONOTRIBUTO",
      monotributoCategory: "H",
      baseCurrency: "ARS",
    },
  });
  console.log(`🏢 Organización lista: ${organization.legalName} (CUIT: ${organization.cuit})`);

  // 3. Punto de venta N° 1
  await prisma.pointOfSale.upsert({
    where: {
      organizationId_number: {
        organizationId: organization.id,
        number: 1,
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      number: 1,
      billingMethod: "CAE",
      address: "Av. Corrientes 1234, CABA",
    },
  });
  console.log("📍 Punto de venta N° 1 listo");

  // 4. Actividad económica
  const existingActivity = await prisma.activity.findFirst({
    where: { organizationId: organization.id, description: "Servicios de Consultoría y Desarrollo de Software" },
  });
  if (!existingActivity) {
    await prisma.activity.create({
      data: {
        organizationId: organization.id,
        arcaActivityCode: "620100",
        description: "Servicios de Consultoría y Desarrollo de Software",
        kind: "SERVICES",
        isPrimary: true,
      },
    });
  }
  console.log("💼 Actividad económica lista");

  // 5. Categorías estándar
  const categories = [
    { name: "Desarrollo de Software", type: "INCOME" as const },
    { name: "Consultoría IT", type: "INCOME" as const },
    { name: "Mantenimiento y Soporte", type: "INCOME" as const },
    { name: "Servicios e Internet", type: "EXPENSE" as const },
    { name: "Hardware y Equipamiento", type: "EXPENSE" as const },
    { name: "Alquiler Oficina", type: "EXPENSE" as const },
    { name: "Monotributo e Impuestos", type: "EXPENSE" as const },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: {
        organizationId_name_type: {
          organizationId: organization.id,
          name: cat.name,
          type: cat.type,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        name: cat.name,
        type: cat.type,
      },
    });
  }
  console.log(`📁 ${categories.length} categorías estándar listas`);

  // 6. Clientes de prueba
  const clients = [
    {
      name: "Acme Corp SRL",
      docType: "CUIT" as const,
      docNumber: "30712345671",
      taxCondition: "RESPONSABLE_INSCRIPTO" as const,
      address: "Av. Libertador 4500, CABA",
      email: "facturacion@acme.com",
      phone: "+54 11 4444-5555",
    },
    {
      name: "Estudio Contable García & Asoc.",
      docType: "CUIT" as const,
      docNumber: "27289876540",
      taxCondition: "MONOTRIBUTO" as const,
      address: "San Martín 650, Rosario",
      email: "contacto@garcia.com",
      phone: "+54 341 555-6666",
    },
    {
      name: "Consumidor Final (Ventas Mostrador)",
      docType: "SIN_IDENTIFICAR" as const,
      docNumber: "0",
      taxCondition: "CONSUMIDOR_FINAL" as const,
      address: null,
      email: null,
      phone: null,
    },
  ];

  for (const cli of clients) {
    await prisma.client.upsert({
      where: {
        organizationId_docType_docNumber: {
          organizationId: organization.id,
          docType: cli.docType,
          docNumber: cli.docNumber,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        ...cli,
      },
    });
  }
  console.log(`👥 ${clients.length} clientes de prueba listos`);

  console.log("\n✨ Base de datos poblada con éxito!");
}

main()
  .catch((e) => {
    console.error("❌ Error ejecutando seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
