-- CreateTable
CREATE TABLE "arca_csr_requests" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "csr" TEXT NOT NULL,
    "private_key_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arca_csr_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arca_csr_requests_organization_id_key" ON "arca_csr_requests"("organization_id");

-- AddForeignKey
ALTER TABLE "arca_csr_requests" ADD CONSTRAINT "arca_csr_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
