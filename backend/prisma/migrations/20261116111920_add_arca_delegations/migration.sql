-- CreateEnum
CREATE TYPE "ArcaDelegationStatus" AS ENUM ('VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "arca_delegations" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "environment" "ArcaEnvironment" NOT NULL DEFAULT 'HOMOLOGACION',
    "status" "ArcaDelegationStatus" NOT NULL,
    "verified_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3) NOT NULL,
    "last_error" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arca_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arca_delegations_organization_id_key" ON "arca_delegations"("organization_id");

-- AddForeignKey
ALTER TABLE "arca_delegations" ADD CONSTRAINT "arca_delegations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
