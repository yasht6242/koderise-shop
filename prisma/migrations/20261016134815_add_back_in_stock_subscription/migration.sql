-- CreateTable
CREATE TABLE "BackInStockSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "BackInStockSubscription_shop_variantId_status_idx" ON "BackInStockSubscription"("shop", "variantId", "status");

-- CreateIndex
CREATE INDEX "BackInStockSubscription_shop_email_idx" ON "BackInStockSubscription"("shop", "email");
