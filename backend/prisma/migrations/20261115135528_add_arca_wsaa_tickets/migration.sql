-- CreateTable
CREATE TABLE "arca_wsaa_tickets" (
    "id" VARCHAR(64) NOT NULL,
    "environment" VARCHAR(50) NOT NULL,
    "service" VARCHAR(50) NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "sign_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arca_wsaa_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "arca_wsaa_tickets_expires_at_idx" ON "arca_wsaa_tickets"("expires_at");
