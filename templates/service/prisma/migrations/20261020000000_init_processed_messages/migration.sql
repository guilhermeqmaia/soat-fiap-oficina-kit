-- Deduplicacao de callbacks/webhooks recebidos por id de envelope (comunicacao HTTP interna, RFC-0008)
CREATE TABLE "processed_messages" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "processed_messages_processada_em_idx" ON "processed_messages"("processada_em");
