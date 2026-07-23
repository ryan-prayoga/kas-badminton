-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "type_id" TEXT,
    "type_name" TEXT,
    "slops" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "players" JSONB NOT NULL DEFAULT '[]',
    "scores" JSONB NOT NULL DEFAULT '{}',
    "koks" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" TEXT,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kok_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_per_person" INTEGER NOT NULL DEFAULT 3000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "price_per_slop" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "kok_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_carry" (
    "name" TEXT NOT NULL,
    "carry" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_carry_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "players" (
    "name" TEXT NOT NULL,
    "photo" TEXT,

    CONSTRAINT "players_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL,
    "default_price_per_person" INTEGER NOT NULL DEFAULT 3000,
    "merchant_qris" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);


-- CreateIndex (expression index, Prisma-unsupported — added manually)
CREATE UNIQUE INDEX IF NOT EXISTS "kok_types_name_lower_uidx" ON "kok_types" (lower("name"));
