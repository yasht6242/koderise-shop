-- CreateTable
CREATE TABLE "BackInStockNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "restockKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sentAt" DATETIME
);

-- CreateIndex
CREATE INDEX "BackInStockNotification_shop_status_createdAt_idx" ON "BackInStockNotification"("shop", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackInStockNotification_subscriptionId_restockKey_key" ON "BackInStockNotification"("subscriptionId", "restockKey");
