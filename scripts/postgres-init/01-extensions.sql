-- Runs once, on first initialisation of an empty data directory.
--
-- Prisma's `postgresqlExtensions` preview feature also declares these, but
-- creating them here means a `prisma db push` on a fresh volume never fails on
-- a missing extension, and the extensions exist even before any migration runs.
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive emails / usernames
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- trigram search for player/plot lookup
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
