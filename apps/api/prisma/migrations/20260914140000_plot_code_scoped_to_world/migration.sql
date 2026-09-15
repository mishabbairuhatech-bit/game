-- =============================================================================
-- Scope plot codes to their world
-- =============================================================================
-- A plot code is derived from its coordinates, so every world generates the
-- same set of codes. The original global UNIQUE therefore made a second world
-- impossible - and worse, it failed silently: `createMany(skipDuplicates)`
-- dropped every colliding row and reported success, so the second world was
-- created with almost no plots and no error anywhere.
-- =============================================================================

DROP INDEX IF EXISTS "plots_code_key";

CREATE UNIQUE INDEX "plots_world_id_code_key" ON "plots"("world_id", "code");
