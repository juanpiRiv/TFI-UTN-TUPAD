-- Ajustes de modelo de la devolución 2 (#106): snapshot del emisor (#95), moneda base ARS (#96)
-- y una sola actividad primaria por organización (#99).

-- #95: datos del emisor copiados a la factura cuando deja de ser borrador
ALTER TABLE "invoices" ADD COLUMN     "issuer_activity_start_date" DATE,
ADD COLUMN     "issuer_address" VARCHAR(255),
ADD COLUMN     "issuer_cuit" CHAR(11),
ADD COLUMN     "issuer_gross_income_number" VARCHAR(50),
ADD COLUMN     "issuer_legal_name" VARCHAR(255),
ADD COLUMN     "issuer_tax_condition" "TaxCondition",
ADD COLUMN     "issuer_trade_name" VARCHAR(255);

-- Las facturas que ya salieron de borrador no tienen la copia: se completa con los datos actuales de la
-- organización (mejor aproximación disponible) para poder exigir la restricción de abajo.
UPDATE "invoices" AS i
SET "issuer_cuit" = o."cuit",
    "issuer_legal_name" = o."legal_name",
    "issuer_trade_name" = o."trade_name",
    "issuer_address" = o."commercial_address",
    "issuer_tax_condition" = o."tax_condition",
    "issuer_gross_income_number" = o."gross_income_number",
    "issuer_activity_start_date" = o."activity_start_date"
FROM "organizations" AS o
WHERE i."organization_id" = o."id" AND i."status" <> 'DRAFT';

-- #99: una sola actividad principal por organización (índice único parcial)
CREATE UNIQUE INDEX "activities_one_primary_per_org" ON "activities"("organization_id") WHERE ("is_primary" = true);

-- CHECK constraints que Prisma no modela (docs/03-modelo-de-datos.md, restricciones)

-- #95: fuera de borrador, la factura tiene los datos obligatorios del emisor
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuer_required_after_draft"
  CHECK ("status" = 'DRAFT' OR ("issuer_cuit" IS NOT NULL AND "issuer_legal_name" IS NOT NULL AND "issuer_tax_condition" IS NOT NULL));

-- #96: en el P0 la moneda base de la organización es siempre ARS
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_base_currency_ars"
  CHECK ("base_currency" = 'ARS');
