/*
  Warnings:

  - Made the column `category_id` on table `transactions` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_payment_id_fkey";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "voided_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "voided_at" TIMESTAMP(3),
ALTER COLUMN "category_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints que Prisma no modela (docs/03-modelo-de-datos.md, restricciones)

-- RN-08 y RN-09: solo una factura autorizada tiene CAE, y toda factura autorizada lo tiene
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cae_only_when_authorized"
  CHECK (("status" = 'AUTHORIZED') = ("cae" IS NOT NULL));

-- RN-05: en moneda extranjera el tipo de cambio es obligatorio
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_exchange_rate_required"
  CHECK ("currency" = 'ARS' OR "exchange_rate" IS NOT NULL);
ALTER TABLE "payments" ADD CONSTRAINT "payments_exchange_rate_required"
  CHECK ("currency" = 'ARS' OR "exchange_rate" IS NOT NULL);
