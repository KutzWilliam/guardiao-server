-- CreateEnum
CREATE TYPE "Status" AS ENUM ('SECURE', 'ALERTA', 'PANICO');

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "fcmToken" TEXT,
    "status" "Status" NOT NULL DEFAULT 'SECURE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timer" (
    "id" SERIAL NOT NULL,
    "eventName" TEXT NOT NULL,
    "targetTimestamp" TIMESTAMP(3) NOT NULL,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT NOT NULL,
    "safeZoneId" TEXT,

    CONSTRAINT "Timer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafeZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "SafeZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanicEvent" (
    "id" SERIAL NOT NULL,
    "triggerType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "PanicEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TimerContacts" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_TimerContacts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Location_deviceId_timestamp_idx" ON "Location"("deviceId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Timer_isActive_targetTimestamp_idx" ON "Timer"("isActive", "targetTimestamp");

-- CreateIndex
CREATE INDEX "_TimerContacts_B_index" ON "_TimerContacts"("B");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timer" ADD CONSTRAINT "Timer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timer" ADD CONSTRAINT "Timer_safeZoneId_fkey" FOREIGN KEY ("safeZoneId") REFERENCES "SafeZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeZone" ADD CONSTRAINT "SafeZone_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TimerContacts" ADD CONSTRAINT "_TimerContacts_A_fkey" FOREIGN KEY ("A") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TimerContacts" ADD CONSTRAINT "_TimerContacts_B_fkey" FOREIGN KEY ("B") REFERENCES "Timer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
