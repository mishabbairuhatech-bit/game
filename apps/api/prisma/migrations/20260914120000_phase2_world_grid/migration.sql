-- =============================================================================
-- PHASE 2: world grid
-- =============================================================================
-- Adds tile-based, configurable world geometry (World/Region/Zone width,
-- height and seed), four new biomes, plot tile anchors and buildability, and
-- a full ownership transfer trail.
--
-- NOT NULL columns are added WITH a temporary DEFAULT which is then dropped.
-- The world tiers are empty in every current deployment (Phase 1 shipped no
-- generator), but a bare `ADD COLUMN ... NOT NULL` would fail hard the moment
-- that stops being true, and a migration that only works on empty tables is a
-- trap for the first person who runs it against real data.
-- =============================================================================

-- CreateEnum
CREATE TYPE "WorldStatus" AS ENUM ('GENERATING', 'ACTIVE', 'LOCKED', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Biome" ADD VALUE 'WATER';
ALTER TYPE "Biome" ADD VALUE 'DESERT';
ALTER TYPE "Biome" ADD VALUE 'SWAMP';
ALTER TYPE "Biome" ADD VALUE 'ROCKY';

-- DropIndex
DROP INDEX "regions_world_id_idx";

-- DropIndex
DROP INDEX "zones_region_id_idx";

-- AlterTable
ALTER TABLE "plot_ownerships" ADD COLUMN     "empire_id" UUID,
ADD COLUMN     "previous_owner_id" UUID,
ADD COLUMN     "transaction_id" TEXT;

-- AlterTable
ALTER TABLE "regions" ADD COLUMN     "height" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "seed" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tile_x" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tile_y" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "width" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "regions"
  ALTER COLUMN "height" DROP DEFAULT,
  ALTER COLUMN "seed" DROP DEFAULT,
  ALTER COLUMN "tile_x" DROP DEFAULT,
  ALTER COLUMN "tile_y" DROP DEFAULT,
  ALTER COLUMN "width" DROP DEFAULT;

-- AlterTable
ALTER TABLE "worlds" DROP COLUMN "is_active",
DROP COLUMN "plots_per_zone_side",
DROP COLUMN "regions_per_side",
DROP COLUMN "tiles_per_plot_side",
DROP COLUMN "zones_per_region_side",
ADD COLUMN     "generated_at" TIMESTAMP(3),
ADD COLUMN     "height" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "plot_size" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "region_size" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "status" "WorldStatus" NOT NULL DEFAULT 'GENERATING',
ADD COLUMN     "width" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "zone_size" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "worlds"
  ALTER COLUMN "height" DROP DEFAULT,
  ALTER COLUMN "plot_size" DROP DEFAULT,
  ALTER COLUMN "region_size" DROP DEFAULT,
  ALTER COLUMN "width" DROP DEFAULT,
  ALTER COLUMN "zone_size" DROP DEFAULT;

-- AlterTable
ALTER TABLE "plots" ADD COLUMN     "is_buildable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "protected_until" TIMESTAMP(3),
ADD COLUMN     "tile_x" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tile_y" INTEGER NOT NULL DEFAULT 0;

-- Backfill tile anchors for any plot that predates this column, then drop the
-- placeholder so the schema matches the Prisma model exactly.
UPDATE "plots" p
SET "tile_x" = p."x" * w."plot_size",
    "tile_y" = p."y" * w."plot_size"
FROM "worlds" w
WHERE w."id" = p."world_id";

ALTER TABLE "plots"
  ALTER COLUMN "tile_x" DROP DEFAULT,
  ALTER COLUMN "tile_y" DROP DEFAULT;

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "height" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "seed" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tile_x" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tile_y" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "width" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "zones"
  ALTER COLUMN "height" DROP DEFAULT,
  ALTER COLUMN "seed" DROP DEFAULT,
  ALTER COLUMN "tile_x" DROP DEFAULT,
  ALTER COLUMN "tile_y" DROP DEFAULT,
  ALTER COLUMN "width" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "plot_ownerships_previous_owner_id_idx" ON "plot_ownerships"("previous_owner_id");

-- CreateIndex
CREATE INDEX "plot_ownerships_transaction_id_idx" ON "plot_ownerships"("transaction_id");

-- CreateIndex
CREATE INDEX "plots_world_id_x_y_status_idx" ON "plots"("world_id", "x", "y", "status");

-- CreateIndex
CREATE INDEX "plots_world_id_status_is_buildable_idx" ON "plots"("world_id", "status", "is_buildable");

-- CreateIndex
CREATE UNIQUE INDEX "plots_zone_id_x_y_key" ON "plots"("zone_id", "x", "y");

-- CreateIndex
CREATE INDEX "regions_world_id_biome_idx" ON "regions"("world_id", "biome");

-- CreateIndex
CREATE INDEX "regions_world_id_tile_x_tile_y_idx" ON "regions"("world_id", "tile_x", "tile_y");

-- CreateIndex
CREATE INDEX "worlds_status_idx" ON "worlds"("status");

-- CreateIndex
CREATE INDEX "zones_region_id_biome_idx" ON "zones"("region_id", "biome");

-- CreateIndex
CREATE INDEX "zones_world_id_tile_x_tile_y_idx" ON "zones"("world_id", "tile_x", "tile_y");

-- CreateIndex
CREATE UNIQUE INDEX "zones_region_id_x_y_key" ON "zones"("region_id", "x", "y");

