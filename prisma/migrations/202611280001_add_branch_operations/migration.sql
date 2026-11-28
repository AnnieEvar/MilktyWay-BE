ALTER TABLE "branches"
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "operating_hours" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "accepts_online" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "max_pending_online" INTEGER NOT NULL DEFAULT 20,
  ADD CONSTRAINT "branches_max_pending_online_check" CHECK ("max_pending_online" > 0);

CREATE TABLE "delivery_zones" (
  "zone_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "area_code" TEXT NOT NULL,
  "fee_vnd" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("zone_id"),
  CONSTRAINT "delivery_zones_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_zones_fee_vnd_check" CHECK ("fee_vnd" >= 0)
);
CREATE UNIQUE INDEX "delivery_zones_branch_id_area_code_key" ON "delivery_zones"("branch_id", "area_code");

CREATE TABLE "cash_shifts" (
  "shift_id" UUID NOT NULL,
  "terminal_id" UUID NOT NULL,
  "opened_by_id" UUID NOT NULL,
  "closed_by_id" UUID,
  "opened_at" TIMESTAMPTZ(3) NOT NULL,
  "closed_at" TIMESTAMPTZ(3),
  "opening_cash_vnd" INTEGER NOT NULL,
  "closing_cash_vnd" INTEGER,
  "note" TEXT,
  CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("shift_id"),
  CONSTRAINT "cash_shifts_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("terminal_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cash_shifts_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cash_shifts_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cash_shifts_cash_check" CHECK ("opening_cash_vnd" >= 0 AND ("closing_cash_vnd" IS NULL OR "closing_cash_vnd" >= 0)),
  CONSTRAINT "cash_shifts_closure_check" CHECK (
    ("closed_at" IS NULL AND "closed_by_id" IS NULL AND "closing_cash_vnd" IS NULL)
    OR ("closed_at" IS NOT NULL AND "closed_by_id" IS NOT NULL AND "closing_cash_vnd" IS NOT NULL AND "closed_at" >= "opened_at")
  )
);
CREATE INDEX "cash_shifts_terminal_id_opened_at_idx" ON "cash_shifts"("terminal_id", "opened_at");
CREATE UNIQUE INDEX "cash_shifts_one_open_per_terminal_key" ON "cash_shifts"("terminal_id") WHERE "closed_at" IS NULL;

-- Business data is accessed through Express, matching the AU foundation migration.
DO $block$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE delivery_zones, cash_shifts FROM %I', api_role);
    END IF;
  END LOOP;
END $block$;
