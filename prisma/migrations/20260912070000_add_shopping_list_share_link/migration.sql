-- CreateTable
CREATE TABLE "ShoppingListShareLink" (
    "id" TEXT NOT NULL,
    "shoppingListId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ShoppingListShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingListShareLink_token_key" ON "ShoppingListShareLink"("token");

-- CreateIndex
CREATE INDEX "ShoppingListShareLink_shoppingListId_idx" ON "ShoppingListShareLink"("shoppingListId");

-- AddForeignKey
ALTER TABLE "ShoppingListShareLink" ADD CONSTRAINT "ShoppingListShareLink_shoppingListId_fkey" FOREIGN KEY ("shoppingListId") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
