-- A coupon typed on fitron.in/windows/buy: the order keeps it and its discount, and a Windows computer can use a coupon once.
-- AlterTable
ALTER TABLE "CouponRedemption" ADD COLUMN     "installationId" TEXT;

-- AlterTable
ALTER TABLE "WindowsLicenceOrder" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "CouponRedemption_installationId_idx" ON "CouponRedemption"("installationId");
