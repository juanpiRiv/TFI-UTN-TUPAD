-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('ARS', 'USD');

-- CreateEnum
CREATE TYPE "TaxCondition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('CUIT', 'CUIL', 'DNI', 'PASAPORTE', 'SIN_IDENTIFICAR');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('FACTURA_C', 'NOTA_DEBITO_C', 'NOTA_CREDITO_C');

-- CreateEnum
CREATE TYPE "InvoiceConcept" AS ENUM ('PRODUCTOS', 'SERVICIOS', 'PRODUCTOS_Y_SERVICIOS');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PENDING', 'AUTHORIZED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('CAE', 'CAEA');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('GOODS', 'SERVICES');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ArcaEnvironment" AS ENUM ('HOMOLOGACION', 'PRODUCCION');

-- CreateTable
CREATE TABLE "activities" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "arca_activity_code" VARCHAR(20),
    "description" VARCHAR(255) NOT NULL,
    "activity_kind" "ActivityKind" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_of_sale" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "billing_method" "BillingMethod" NOT NULL DEFAULT 'CAE',
    "address" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "points_of_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "doc_type" "DocType",
    "doc_number" VARCHAR(20),
    "name" VARCHAR(255) NOT NULL,
    "address" VARCHAR(255),
    "tax_condition" "TaxCondition",
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "MovementType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" SERIAL NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "rate_type" VARCHAR(50) NOT NULL,
    "from_currency" "Currency" NOT NULL,
    "to_currency" "Currency" NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "observed_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "payment_id" INTEGER,
    "category_id" INTEGER,
    "type" "MovementType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "exchange_rate" DECIMAL(18,6),
    "transaction_date" DATE NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "point_of_sale_id" INTEGER NOT NULL,
    "client_id" INTEGER,
    "associated_invoice_id" INTEGER,
    "voucher_type" "VoucherType" NOT NULL,
    "voucher_number" INTEGER,
    "concept" "InvoiceConcept" NOT NULL,
    "issue_date" DATE NOT NULL,
    "recipient_doc_type" "DocType",
    "recipient_doc_number" VARCHAR(20),
    "recipient_name" VARCHAR(255),
    "recipient_address" VARCHAR(255),
    "recipient_tax_condition" "TaxCondition",
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "fiscal_exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "service_from" DATE,
    "service_to" DATE,
    "payment_due_date" DATE,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "cae" VARCHAR(14),
    "cae_expiration" DATE,
    "arca_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "authorized_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "exchange_rate" DECIMAL(18,6),
    "payment_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "cuit" CHAR(11) NOT NULL,
    "legal_name" VARCHAR(255) NOT NULL,
    "trade_name" VARCHAR(255),
    "commercial_address" VARCHAR(255),
    "tax_condition" "TaxCondition" NOT NULL,
    "monotributo_category" VARCHAR(10),
    "activity_start_date" DATE,
    "gross_income_number" VARCHAR(50),
    "base_currency" "Currency" NOT NULL DEFAULT 'ARS',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arca_credentials" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "environment" "ArcaEnvironment" NOT NULL DEFAULT 'HOMOLOGACION',
    "service" VARCHAR(50) NOT NULL DEFAULT 'wsfe',
    "certificate" TEXT NOT NULL,
    "private_key_encrypted" TEXT NOT NULL,
    "token" TEXT,
    "sign" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arca_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_organization_id_idx" ON "activities"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "points_of_sale_organization_id_number_key" ON "points_of_sale"("organization_id", "number");

-- CreateIndex
CREATE INDEX "clients_organization_id_idx" ON "clients"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_doc_type_doc_number_key" ON "clients"("organization_id", "doc_type", "doc_number");

-- CreateIndex
CREATE UNIQUE INDEX "categories_organization_id_name_type_key" ON "categories"("organization_id", "name", "type");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_source_rate_type_from_currency_to_currency_o_key" ON "exchange_rates"("source", "rate_type", "from_currency", "to_currency", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_payment_id_key" ON "transactions"("payment_id");

-- CreateIndex
CREATE INDEX "transactions_organization_id_transaction_date_idx" ON "transactions"("organization_id", "transaction_date");

-- CreateIndex
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_issue_date_idx" ON "invoices"("organization_id", "issue_date");

-- CreateIndex
CREATE INDEX "invoices_client_id_idx" ON "invoices"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_point_of_sale_id_voucher_type_voucher_number_key" ON "invoices"("point_of_sale_id", "voucher_type", "voucher_number");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_user_id_key" ON "organizations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_cuit_key" ON "organizations"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "arca_credentials_organization_id_environment_service_key" ON "arca_credentials"("organization_id", "environment", "service");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_of_sale" ADD CONSTRAINT "points_of_sale_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_point_of_sale_id_fkey" FOREIGN KEY ("point_of_sale_id") REFERENCES "points_of_sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_associated_invoice_id_fkey" FOREIGN KEY ("associated_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arca_credentials" ADD CONSTRAINT "arca_credentials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
