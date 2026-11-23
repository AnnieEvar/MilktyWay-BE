-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "staff_role" AS ENUM ('ADMIN', 'BRANCH_MANAGER', 'POS_STAFF', 'INVENTORY_STAFF');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "session_kind" AS ENUM ('STAFF', 'CUSTOMER');

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "staff_role" NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "branches" (
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("branch_id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("warehouse_id")
);

-- CreateTable
CREATE TABLE "pos_terminals" (
    "terminal_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pos_terminals_pkey" PRIMARY KEY ("terminal_id")
);

-- CreateTable
CREATE TABLE "staff_assignments" (
    "assignment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID,
    "warehouse_id" UUID,
    "terminal_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "customer_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "joined_at" TIMESTAMPTZ(3),
    "consent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "session_id" UUID NOT NULL,
    "kind" "session_kind" NOT NULL,
    "user_id" UUID,
    "customer_id" UUID,
    "csrf_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "refresh_token_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("refresh_token_id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "challenge_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'CUSTOMER_LOGIN',
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("challenge_id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "audit_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_code_key" ON "users"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_branch_id_code_key" ON "pos_terminals"("branch_id", "code");

-- CreateIndex
CREATE INDEX "staff_assignments_user_id_ended_at_idx" ON "staff_assignments"("user_id", "ended_at");

-- CreateIndex
CREATE INDEX "staff_assignments_branch_id_ended_at_idx" ON "staff_assignments"("branch_id", "ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_sessions_customer_id_revoked_at_idx" ON "auth_sessions"("customer_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_created_at_idx" ON "otp_challenges"("phone", "created_at");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_id_created_at_idx" ON "audit_logs"("target_id", "created_at");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("terminal_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants not fully expressed by the Prisma schema.
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_subject_check CHECK (
  (kind = 'STAFF' AND user_id IS NOT NULL AND customer_id IS NULL)
  OR (kind = 'CUSTOMER' AND customer_id IS NOT NULL AND user_id IS NULL)
);
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_expiry_check CHECK (idle_expires_at <= expires_at);
ALTER TABLE staff_assignments ADD CONSTRAINT staff_assignments_scope_check CHECK (branch_id IS NOT NULL OR warehouse_id IS NOT NULL);
ALTER TABLE staff_assignments ADD CONSTRAINT staff_assignments_terminal_check CHECK (terminal_id IS NULL OR branch_id IS NOT NULL);
ALTER TABLE staff_assignments ADD CONSTRAINT staff_assignments_dates_check CHECK (ended_at IS NULL OR ended_at >= started_at);
CREATE UNIQUE INDEX staff_assignments_one_active_user_idx ON staff_assignments(user_id) WHERE ended_at IS NULL;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_attempts_check CHECK (attempts >= 0 AND attempts <= 5);
ALTER TABLE users ADD CONSTRAINT users_normalized_email_check CHECK (email = lower(btrim(email)));
ALTER TABLE customers ADD CONSTRAINT customers_phone_check CHECK (phone ~ '^0[0-9]{9}$');
ALTER TABLE customers ADD CONSTRAINT customers_membership_consent_check CHECK ((joined_at IS NULL) = (consent_at IS NULL));

-- Prevent Supabase Data API roles from receiving direct application-table access.
-- This migration never modifies Supabase-managed auth/storage schemas.
DO $block$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE users, branches, warehouses, pos_terminals, staff_assignments, customers, auth_sessions, refresh_tokens, otp_challenges, rate_limit_buckets, audit_logs FROM %I', api_role);
    END IF;
  END LOOP;
END $block$;
