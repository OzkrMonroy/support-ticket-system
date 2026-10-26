-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('TICKET_ASSIGNMENT', 'EMAIL_NOTIFICATION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobResult" AS ENUM ('SUCCESS', 'SKIPPED');

-- CreateTable
CREATE TABLE "AsyncJob" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "event" TEXT,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "result" "JobResult",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimToken" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AsyncJob_eventKey_key" ON "AsyncJob"("eventKey");

-- CreateIndex
CREATE INDEX "AsyncJob_status_publishedAt_idx" ON "AsyncJob"("status", "publishedAt");

-- AddForeignKey
ALTER TABLE "AsyncJob" ADD CONSTRAINT "AsyncJob_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
