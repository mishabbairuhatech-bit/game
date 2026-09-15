-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_CHANGE');

-- CreateEnum
CREATE TYPE "Biome" AS ENUM ('GRASSLAND', 'FOREST', 'MOUNTAIN', 'RIVERLAND', 'LAKESHORE', 'HIGHLAND', 'BADLANDS', 'TUNDRA');

-- CreateEnum
CREATE TYPE "PlotStatus" AS ENUM ('FREE', 'STARTER', 'OWNED', 'FOR_SALE', 'LOCKED', 'PROTECTED', 'EVENT', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "PlotAcquisition" AS ENUM ('STARTER_GRANT', 'WORLD_PURCHASE', 'MARKETPLACE_PURCHASE', 'ADMIN_GRANT', 'EVENT_REWARD');

-- CreateEnum
CREATE TYPE "BuildingCategory" AS ENUM ('CORE', 'PRODUCTION', 'STORAGE', 'MILITARY', 'DEFENSE', 'WALL', 'UTILITY', 'DECORATION');

-- CreateEnum
CREATE TYPE "BuildingState" AS ENUM ('CONSTRUCTING', 'ACTIVE', 'UPGRADING', 'DAMAGED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "UnitClass" AS ENUM ('INFANTRY', 'RANGED', 'CAVALRY', 'SIEGE', 'CASTER');

-- CreateEnum
CREATE TYPE "CurrencyKey" AS ENUM ('COINS', 'GEMS', 'WOOD', 'STONE', 'FOOD', 'IRON', 'GOLD');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('CURRENCY', 'PREMIUM', 'RESOURCE');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('SIGNUP_GRANT', 'PRODUCTION_COLLECT', 'BUILDING_CONSTRUCT', 'BUILDING_UPGRADE', 'BUILDING_REFUND', 'UNIT_TRAINING', 'UNIT_REFUND', 'RESEARCH', 'PLOT_PURCHASE_WORLD', 'PLOT_PURCHASE_MARKET', 'PLOT_SALE_PROCEEDS', 'MARKETPLACE_FEE', 'BATTLE_LOOT_GAINED', 'BATTLE_LOOT_LOST', 'QUEST_REWARD', 'ACHIEVEMENT_REWARD', 'PAYMENT_CREDIT', 'PAYMENT_REFUND', 'ADMIN_ADJUSTMENT', 'SHIELD_PURCHASE', 'RUSH_TIMER', 'ALLIANCE_DONATION', 'TREASURY_MINT');

-- CreateEnum
CREATE TYPE "BattleStatus" AS ENUM ('MATCHING', 'PREPARING', 'ACTIVE', 'RESOLVING', 'COMPLETED', 'ABANDONED', 'ERRORED');

-- CreateEnum
CREATE TYPE "BattleRole" AS ENUM ('ATTACKER', 'DEFENDER');

-- CreateEnum
CREATE TYPE "BattleOutcome" AS ENUM ('ATTACKER_VICTORY', 'DEFENDER_VICTORY', 'DRAW', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('PLOT', 'ITEM');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'LOCKED', 'SOLD', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'STRIPE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "QuestKind" AS ENUM ('DAILY', 'WEEKLY', 'STORY', 'EVENT');

-- CreateEnum
CREATE TYPE "QuestStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLAIMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AllianceRole" AS ENUM ('MEMBER', 'ELDER', 'OFFICER', 'LEADER');

-- CreateEnum
CREATE TYPE "FriendStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('GLOBAL', 'ALLIANCE', 'DIRECT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BUILDING_COMPLETED', 'UPGRADE_COMPLETED', 'TRAINING_COMPLETED', 'ATTACK_RECEIVED', 'BATTLE_COMPLETED', 'PLOT_SOLD', 'PLOT_PURCHASED', 'QUEST_COMPLETED', 'ACHIEVEMENT_UNLOCKED', 'ALLIANCE_INVITATION', 'PAYMENT_CREDITED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LeaderboardCategory" AS ENUM ('LEVEL', 'EMPIRE_POWER', 'LAND', 'VICTORIES', 'WEALTH', 'DEFENSE');

-- CreateEnum
CREATE TYPE "LeaderboardPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME');

-- CreateEnum
CREATE TYPE "ShieldReason" AS ENUM ('NEW_PLAYER', 'DEFEAT_PROTECTION', 'PURCHASED', 'ADMIN_GRANT', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "InventoryItemType" AS ENUM ('RESOURCE_BUNDLE', 'BOOST', 'DECORATION', 'SKIN', 'SHIELD_TOKEN', 'SPECIAL');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "SuspicionKind" AS ENUM ('IMPOSSIBLE_RESOURCE_GAIN', 'IMPOSSIBLE_MOVEMENT', 'INVALID_PLACEMENT', 'INVALID_BATTLE_ACTION', 'DUPLICATE_TRANSACTION', 'DUPLICATE_WEBHOOK', 'IMPOSSIBLE_ARMY_SIZE', 'NEGATIVE_BALANCE', 'RATE_ABUSE', 'CLIENT_TAMPERING');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT,
    "username" CITEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email_verified_at" TIMESTAMP(3),
    "avatar_url" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "banned_at" TIMESTAMP(3),
    "ban_reason" TEXT,
    "muted_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "empire_name" TEXT,
    "bio" VARCHAR(280),
    "banner_key" TEXT,
    "country_code" VARCHAR(2),
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "empire_power" INTEGER NOT NULL DEFAULT 0,
    "battles_won" INTEGER NOT NULL DEFAULT 0,
    "battles_lost" INTEGER NOT NULL DEFAULT 0,
    "raids_defended" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "payload" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worlds" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "regions_per_side" INTEGER NOT NULL,
    "zones_per_region_side" INTEGER NOT NULL,
    "plots_per_zone_side" INTEGER NOT NULL,
    "tiles_per_plot_side" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "biome" "Biome" NOT NULL,
    "price_modifier_bps" INTEGER NOT NULL DEFAULT 10000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "biome" "Biome" NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plots" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "biome" "Biome" NOT NULL,
    "status" "PlotStatus" NOT NULL DEFAULT 'FREE',
    "price" BIGINT NOT NULL DEFAULT 0,
    "is_for_sale" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" UUID,
    "empire_id" UUID,
    "water_coverage_bps" INTEGER NOT NULL DEFAULT 0,
    "terrain" JSONB,
    "acquired_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plot_ownerships" (
    "id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "acquisition" "PlotAcquisition" NOT NULL,
    "price_paid" BIGINT NOT NULL DEFAULT 0,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plot_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empires" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "wood" INTEGER NOT NULL DEFAULT 0,
    "stone" INTEGER NOT NULL DEFAULT 0,
    "food" INTEGER NOT NULL DEFAULT 0,
    "iron" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "wood_capacity" INTEGER NOT NULL DEFAULT 1000,
    "stone_capacity" INTEGER NOT NULL DEFAULT 1000,
    "food_capacity" INTEGER NOT NULL DEFAULT 1000,
    "iron_capacity" INTEGER NOT NULL DEFAULT 500,
    "gold_capacity" INTEGER NOT NULL DEFAULT 250,
    "last_accrual_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hq_level" INTEGER NOT NULL DEFAULT 1,
    "builders" INTEGER NOT NULL DEFAULT 1,
    "population_used" INTEGER NOT NULL DEFAULT 0,
    "population_cap" INTEGER NOT NULL DEFAULT 20,
    "empire_power" INTEGER NOT NULL DEFAULT 0,
    "last_attack_at" TIMESTAMP(3),
    "last_plot_buy_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "key" "CurrencyKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "raidable" BOOLEAN NOT NULL DEFAULT false,
    "max_loot_bps" INTEGER NOT NULL DEFAULT 0,
    "base_storage" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_definitions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "BuildingCategory" NOT NULL,
    "footprint_width" INTEGER NOT NULL,
    "footprint_height" INTEGER NOT NULL,
    "is_unique" BOOLEAN NOT NULL DEFAULT false,
    "blocks_movement" BOOLEAN NOT NULL DEFAULT true,
    "allowed_biomes" "Biome"[],
    "asset" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_levels" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "build_cost" JSONB NOT NULL,
    "build_seconds" INTEGER NOT NULL,
    "hitpoints" INTEGER NOT NULL,
    "production" JSONB,
    "storage" JSONB,
    "defense" JSONB,
    "capacity" JSONB,
    "required_hq_level" INTEGER NOT NULL,
    "max_count_at_hq" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_definitions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit_class" "UnitClass" NOT NULL,
    "hitpoints" INTEGER NOT NULL,
    "damage" INTEGER NOT NULL,
    "defense" INTEGER NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "range" DOUBLE PRECISION NOT NULL,
    "attack_cooldown_ms" INTEGER NOT NULL,
    "train_cost" JSONB NOT NULL,
    "train_seconds" INTEGER NOT NULL,
    "population" INTEGER NOT NULL,
    "trained_at" TEXT NOT NULL,
    "unlock_at_building_level" INTEGER NOT NULL,
    "preferred_targets" JSONB,
    "asset" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_config" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "value_type" TEXT NOT NULL DEFAULT 'string',
    "description" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'general',
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "empire_id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "state" "BuildingState" NOT NULL DEFAULT 'ACTIVE',
    "tile_x" INTEGER NOT NULL,
    "tile_y" INTEGER NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "current_hp" INTEGER NOT NULL,
    "ready_at" TIMESTAMP(3),
    "last_collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_upgrades" (
    "id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "empire_id" UUID NOT NULL,
    "from_level" INTEGER NOT NULL,
    "to_level" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "cost_paid" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishes_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_upgrades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" UUID NOT NULL,
    "empire_id" UUID NOT NULL,
    "slots" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "item_key" TEXT NOT NULL,
    "type" "InventoryItemType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "armies" (
    "id" UUID NOT NULL,
    "empire_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "armies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "army_units" (
    "id" UUID NOT NULL,
    "army_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "army_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_queues" (
    "id" UUID NOT NULL,
    "empire_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "building_id" UUID,
    "quantity" INTEGER NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "status" "JobStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "cost_paid" JSONB NOT NULL,
    "seconds_per_unit" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishes_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battles" (
    "id" UUID NOT NULL,
    "world_id" UUID,
    "status" "BattleStatus" NOT NULL DEFAULT 'MATCHING',
    "seed" TEXT NOT NULL,
    "layout_snapshot" JSONB NOT NULL,
    "army_snapshot" JSONB NOT NULL,
    "tick_rate_hz" INTEGER NOT NULL DEFAULT 10,
    "duration_seconds" INTEGER NOT NULL DEFAULT 180,
    "preparation_seconds" INTEGER NOT NULL DEFAULT 20,
    "started_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_participants" (
    "id" UUID NOT NULL,
    "battle_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "BattleRole" NOT NULL,
    "power_at_start" INTEGER NOT NULL DEFAULT 0,
    "units_deployed" JSONB NOT NULL DEFAULT '{}',
    "units_lost" JSONB NOT NULL DEFAULT '{}',
    "buildings_destroyed" INTEGER NOT NULL DEFAULT 0,
    "damage_dealt" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battle_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_results" (
    "id" UUID NOT NULL,
    "battle_id" UUID NOT NULL,
    "outcome" "BattleOutcome" NOT NULL,
    "destruction_percent" INTEGER NOT NULL,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "loot_awarded" JSONB NOT NULL DEFAULT '{}',
    "attacker_xp" INTEGER NOT NULL DEFAULT 0,
    "defender_xp" INTEGER NOT NULL DEFAULT 0,
    "replay_log" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shields" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" "ShieldReason" NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "broken_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "coins" BIGINT NOT NULL DEFAULT 0,
    "gems" BIGINT NOT NULL DEFAULT 0,
    "lifetime_coins_earned" BIGINT NOT NULL DEFAULT 0,
    "lifetime_gems_purchased" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "currency" "CurrencyKey" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "metadata" JSONB,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" UUID NOT NULL,
    "type" "ListingType" NOT NULL DEFAULT 'PLOT',
    "seller_id" UUID NOT NULL,
    "plot_id" UUID,
    "item_key" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" BIGINT NOT NULL,
    "fee_bps" INTEGER NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "locked_at" TIMESTAMP(3),
    "locked_by_user_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "sold_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_transactions" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "plot_id" UUID,
    "price" BIGINT NOT NULL,
    "fee_amount" BIGINT NOT NULL,
    "seller_proceeds" BIGINT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_packages" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "gems" INTEGER NOT NULL,
    "bonus_gems" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "package_id" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "provider_signature" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "gems_to_credit" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "credited_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "raw_order" JSONB,
    "raw_webhook" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payment_id" UUID,
    "signature_valid" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quests" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "QuestKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objective" JSONB NOT NULL,
    "rewards" JSONB NOT NULL,
    "required_level" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_quests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "quest_id" UUID NOT NULL,
    "status" "QuestStatus" NOT NULL DEFAULT 'ASSIGNED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER NOT NULL,
    "period_key" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_quests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "criteria" JSONB NOT NULL,
    "rewards" JSONB NOT NULL,
    "icon" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_achievements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "achievement_id" UUID NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "unlocked_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technologies" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "cost" JSONB NOT NULL,
    "research_seconds" INTEGER NOT NULL,
    "required_hq_level" INTEGER NOT NULL DEFAULT 1,
    "prerequisites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "effects" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "researches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "technology_id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "cost_paid" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishes_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "researches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alliances" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "tag" CITEXT NOT NULL,
    "description" VARCHAR(500),
    "emblem" JSONB,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "min_level" INTEGER NOT NULL DEFAULT 1,
    "max_members" INTEGER NOT NULL DEFAULT 50,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "total_power" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alliances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alliance_members" (
    "id" UUID NOT NULL,
    "alliance_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "AllianceRole" NOT NULL DEFAULT 'MEMBER',
    "contribution" BIGINT NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alliance_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alliance_invitations" (
    "id" UUID NOT NULL,
    "alliance_id" UUID NOT NULL,
    "invited_user_id" UUID NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "message" VARCHAR(300),
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alliance_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friends" (
    "id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "addressee_id" UUID NOT NULL,
    "status" "FriendStatus" NOT NULL DEFAULT 'PENDING',
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "author_id" UUID,
    "recipient_id" UUID,
    "alliance_id" UUID,
    "body" VARCHAR(1000) NOT NULL,
    "redacted_at" TIMESTAMP(3),
    "redacted_by_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_users" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "details" VARCHAR(1000) NOT NULL,
    "context_type" TEXT,
    "context_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboards" (
    "id" UUID NOT NULL,
    "category" "LeaderboardCategory" NOT NULL,
    "period" "LeaderboardPeriod" NOT NULL,
    "period_key" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaderboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_entries" (
    "id" UUID NOT NULL,
    "leaderboard_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" BIGINT NOT NULL,
    "previous_rank" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaderboard_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suspicious_activities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "SuspicionKind" NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "details" JSONB NOT NULL,
    "request_id" TEXT,
    "ip_address" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suspicious_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE INDEX "profiles_level_idx" ON "profiles"("level");

-- CreateIndex
CREATE INDEX "profiles_empire_power_idx" ON "profiles"("empire_power");

-- CreateIndex
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_user_id_key" ON "oauth_accounts"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_type_idx" ON "verification_tokens"("user_id", "type");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "worlds_slug_key" ON "worlds"("slug");

-- CreateIndex
CREATE INDEX "regions_world_id_idx" ON "regions"("world_id");

-- CreateIndex
CREATE UNIQUE INDEX "regions_world_id_x_y_key" ON "regions"("world_id", "x", "y");

-- CreateIndex
CREATE INDEX "zones_region_id_idx" ON "zones"("region_id");

-- CreateIndex
CREATE UNIQUE INDEX "zones_world_id_x_y_key" ON "zones"("world_id", "x", "y");

-- CreateIndex
CREATE UNIQUE INDEX "plots_code_key" ON "plots"("code");

-- CreateIndex
CREATE INDEX "plots_zone_id_status_idx" ON "plots"("zone_id", "status");

-- CreateIndex
CREATE INDEX "plots_region_id_status_idx" ON "plots"("region_id", "status");

-- CreateIndex
CREATE INDEX "plots_owner_id_idx" ON "plots"("owner_id");

-- CreateIndex
CREATE INDEX "plots_empire_id_idx" ON "plots"("empire_id");

-- CreateIndex
CREATE INDEX "plots_status_is_for_sale_idx" ON "plots"("status", "is_for_sale");

-- CreateIndex
CREATE INDEX "plots_biome_idx" ON "plots"("biome");

-- CreateIndex
CREATE UNIQUE INDEX "plots_world_id_x_y_key" ON "plots"("world_id", "x", "y");

-- CreateIndex
CREATE INDEX "plot_ownerships_user_id_released_at_idx" ON "plot_ownerships"("user_id", "released_at");

-- CreateIndex
CREATE INDEX "plot_ownerships_plot_id_acquired_at_idx" ON "plot_ownerships"("plot_id", "acquired_at");

-- CreateIndex
CREATE UNIQUE INDEX "empires_user_id_key" ON "empires"("user_id");

-- CreateIndex
CREATE INDEX "empires_empire_power_idx" ON "empires"("empire_power");

-- CreateIndex
CREATE UNIQUE INDEX "resources_key_key" ON "resources"("key");

-- CreateIndex
CREATE UNIQUE INDEX "building_definitions_key_key" ON "building_definitions"("key");

-- CreateIndex
CREATE INDEX "building_definitions_category_idx" ON "building_definitions"("category");

-- CreateIndex
CREATE INDEX "building_levels_definition_id_idx" ON "building_levels"("definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "building_levels_definition_id_level_key" ON "building_levels"("definition_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "unit_definitions_key_key" ON "unit_definitions"("key");

-- CreateIndex
CREATE INDEX "unit_definitions_unit_class_idx" ON "unit_definitions"("unit_class");

-- CreateIndex
CREATE UNIQUE INDEX "game_config_key_key" ON "game_config"("key");

-- CreateIndex
CREATE INDEX "game_config_group_idx" ON "game_config"("group");

-- CreateIndex
CREATE INDEX "buildings_empire_id_state_idx" ON "buildings"("empire_id", "state");

-- CreateIndex
CREATE INDEX "buildings_plot_id_idx" ON "buildings"("plot_id");

-- CreateIndex
CREATE INDEX "buildings_definition_id_idx" ON "buildings"("definition_id");

-- CreateIndex
CREATE INDEX "buildings_ready_at_idx" ON "buildings"("ready_at");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_plot_id_tile_x_tile_y_key" ON "buildings"("plot_id", "tile_x", "tile_y");

-- CreateIndex
CREATE INDEX "building_upgrades_empire_id_status_idx" ON "building_upgrades"("empire_id", "status");

-- CreateIndex
CREATE INDEX "building_upgrades_status_finishes_at_idx" ON "building_upgrades"("status", "finishes_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventories_empire_id_key" ON "inventories"("empire_id");

-- CreateIndex
CREATE INDEX "inventory_items_inventory_id_type_idx" ON "inventory_items"("inventory_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_inventory_id_item_key_key" ON "inventory_items"("inventory_id", "item_key");

-- CreateIndex
CREATE UNIQUE INDEX "armies_empire_id_key" ON "armies"("empire_id");

-- CreateIndex
CREATE INDEX "army_units_army_id_idx" ON "army_units"("army_id");

-- CreateIndex
CREATE UNIQUE INDEX "army_units_army_id_definition_id_key" ON "army_units"("army_id", "definition_id");

-- CreateIndex
CREATE INDEX "training_queues_empire_id_status_idx" ON "training_queues"("empire_id", "status");

-- CreateIndex
CREATE INDEX "training_queues_status_finishes_at_idx" ON "training_queues"("status", "finishes_at");

-- CreateIndex
CREATE INDEX "battles_status_created_at_idx" ON "battles"("status", "created_at");

-- CreateIndex
CREATE INDEX "battles_status_ends_at_idx" ON "battles"("status", "ends_at");

-- CreateIndex
CREATE INDEX "battle_participants_user_id_created_at_idx" ON "battle_participants"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "battle_participants_battle_id_role_key" ON "battle_participants"("battle_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "battle_results_battle_id_key" ON "battle_results"("battle_id");

-- CreateIndex
CREATE INDEX "battle_results_outcome_idx" ON "battle_results"("outcome");

-- CreateIndex
CREATE INDEX "shields_user_id_expires_at_idx" ON "shields"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "currency_transactions_idempotency_key_key" ON "currency_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "currency_transactions_user_id_created_at_idx" ON "currency_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "currency_transactions_reason_created_at_idx" ON "currency_transactions"("reason", "created_at");

-- CreateIndex
CREATE INDEX "currency_transactions_currency_created_at_idx" ON "currency_transactions"("currency", "created_at");

-- CreateIndex
CREATE INDEX "marketplace_listings_status_expires_at_idx" ON "marketplace_listings"("status", "expires_at");

-- CreateIndex
CREATE INDEX "marketplace_listings_seller_id_status_idx" ON "marketplace_listings"("seller_id", "status");

-- CreateIndex
CREATE INDEX "marketplace_listings_plot_id_status_idx" ON "marketplace_listings"("plot_id", "status");

-- CreateIndex
CREATE INDEX "marketplace_listings_price_idx" ON "marketplace_listings"("price");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_transactions_idempotency_key_key" ON "marketplace_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "marketplace_transactions_buyer_id_created_at_idx" ON "marketplace_transactions"("buyer_id", "created_at");

-- CreateIndex
CREATE INDEX "marketplace_transactions_seller_id_created_at_idx" ON "marketplace_transactions"("seller_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_packages_sku_key" ON "payment_packages"("sku");

-- CreateIndex
CREATE INDEX "payment_packages_is_active_sort_order_idx" ON "payment_packages"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_order_id_key" ON "payments"("provider", "provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_processed_at_idx" ON "payment_webhook_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "quests_key_key" ON "quests"("key");

-- CreateIndex
CREATE INDEX "quests_kind_is_active_idx" ON "quests"("kind", "is_active");

-- CreateIndex
CREATE INDEX "player_quests_user_id_status_idx" ON "player_quests"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "player_quests_user_id_quest_id_period_key_key" ON "player_quests"("user_id", "quest_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_key_key" ON "achievements"("key");

-- CreateIndex
CREATE INDEX "achievements_category_idx" ON "achievements"("category");

-- CreateIndex
CREATE INDEX "player_achievements_user_id_unlocked_at_idx" ON "player_achievements"("user_id", "unlocked_at");

-- CreateIndex
CREATE UNIQUE INDEX "player_achievements_user_id_achievement_id_key" ON "player_achievements"("user_id", "achievement_id");

-- CreateIndex
CREATE UNIQUE INDEX "technologies_key_key" ON "technologies"("key");

-- CreateIndex
CREATE INDEX "technologies_branch_tier_idx" ON "technologies"("branch", "tier");

-- CreateIndex
CREATE INDEX "researches_status_finishes_at_idx" ON "researches"("status", "finishes_at");

-- CreateIndex
CREATE UNIQUE INDEX "researches_user_id_technology_id_key" ON "researches"("user_id", "technology_id");

-- CreateIndex
CREATE UNIQUE INDEX "alliances_name_key" ON "alliances"("name");

-- CreateIndex
CREATE UNIQUE INDEX "alliances_tag_key" ON "alliances"("tag");

-- CreateIndex
CREATE INDEX "alliances_total_power_idx" ON "alliances"("total_power");

-- CreateIndex
CREATE UNIQUE INDEX "alliance_members_user_id_key" ON "alliance_members"("user_id");

-- CreateIndex
CREATE INDEX "alliance_members_alliance_id_role_idx" ON "alliance_members"("alliance_id", "role");

-- CreateIndex
CREATE INDEX "alliance_invitations_invited_user_id_idx" ON "alliance_invitations"("invited_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "alliance_invitations_alliance_id_invited_user_id_key" ON "alliance_invitations"("alliance_id", "invited_user_id");

-- CreateIndex
CREATE INDEX "friends_addressee_id_status_idx" ON "friends"("addressee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "friends_requester_id_addressee_id_key" ON "friends"("requester_id", "addressee_id");

-- CreateIndex
CREATE INDEX "messages_channel_created_at_idx" ON "messages"("channel", "created_at");

-- CreateIndex
CREATE INDEX "messages_alliance_id_created_at_idx" ON "messages"("alliance_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_recipient_id_read_at_idx" ON "messages"("recipient_id", "read_at");

-- CreateIndex
CREATE INDEX "messages_author_id_created_at_idx" ON "messages"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "blocked_users_user_id_idx" ON "blocked_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_users_user_id_blocked_id_key" ON "blocked_users"("user_id", "blocked_id");

-- CreateIndex
CREATE INDEX "reports_resolved_at_created_at_idx" ON "reports"("resolved_at", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_user_id_idx" ON "reports"("target_user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboards_category_period_period_key_key" ON "leaderboards"("category", "period", "period_key");

-- CreateIndex
CREATE INDEX "leaderboard_entries_leaderboard_id_rank_idx" ON "leaderboard_entries"("leaderboard_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_entries_leaderboard_id_user_id_key" ON "leaderboard_entries"("leaderboard_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "suspicious_activities_user_id_created_at_idx" ON "suspicious_activities"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "suspicious_activities_kind_severity_idx" ON "suspicious_activities"("kind", "severity");

-- CreateIndex
CREATE INDEX "suspicious_activities_reviewed_at_idx" ON "suspicious_activities"("reviewed_at");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_empire_id_fkey" FOREIGN KEY ("empire_id") REFERENCES "empires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plot_ownerships" ADD CONSTRAINT "plot_ownerships_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plot_ownerships" ADD CONSTRAINT "plot_ownerships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empires" ADD CONSTRAINT "empires_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_levels" ADD CONSTRAINT "building_levels_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "building_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_empire_id_fkey" FOREIGN KEY ("empire_id") REFERENCES "empires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "building_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_upgrades" ADD CONSTRAINT "building_upgrades_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_upgrades" ADD CONSTRAINT "building_upgrades_empire_id_fkey" FOREIGN KEY ("empire_id") REFERENCES "empires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_empire_id_fkey" FOREIGN KEY ("empire_id") REFERENCES "empires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "armies" ADD CONSTRAINT "armies_empire_id_fkey" FOREIGN KEY ("empire_id") REFERENCES "empires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "army_units" ADD CONSTRAINT "army_units_army_id_fkey" FOREIGN KEY ("army_id") REFERENCES "armies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "army_units" ADD CONSTRAINT "army_units_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_queues" ADD CONSTRAINT "training_queues_empire_id_fkey" FOREIGN KEY ("empire_id") REFERENCES "empires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_queues" ADD CONSTRAINT "training_queues_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_results" ADD CONSTRAINT "battle_results_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shields" ADD CONSTRAINT "shields_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_transactions" ADD CONSTRAINT "currency_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "marketplace_transactions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "marketplace_transactions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "marketplace_transactions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "payment_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_quests" ADD CONSTRAINT "player_quests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_quests" ADD CONSTRAINT "player_quests_quest_id_fkey" FOREIGN KEY ("quest_id") REFERENCES "quests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researches" ADD CONSTRAINT "researches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researches" ADD CONSTRAINT "researches_technology_id_fkey" FOREIGN KEY ("technology_id") REFERENCES "technologies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alliance_members" ADD CONSTRAINT "alliance_members_alliance_id_fkey" FOREIGN KEY ("alliance_id") REFERENCES "alliances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alliance_members" ADD CONSTRAINT "alliance_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alliance_invitations" ADD CONSTRAINT "alliance_invitations_alliance_id_fkey" FOREIGN KEY ("alliance_id") REFERENCES "alliances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_leaderboard_id_fkey" FOREIGN KEY ("leaderboard_id") REFERENCES "leaderboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspicious_activities" ADD CONSTRAINT "suspicious_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

