-- CreateTable
CREATE TABLE "ShopSetting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "backInStockEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
