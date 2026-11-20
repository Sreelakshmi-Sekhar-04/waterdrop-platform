CREATE TYPE "public"."account_entry_type" AS ENUM('delivery_charge', 'payment', 'reversal', 'opening', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."attempt_outcome" AS ENUM('delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."can_entry_type" AS ENUM('delivery', 'return', 'reversal', 'opening', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."can_state" AS ENUM('full', 'empty', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."deposit_entry_type" AS ENUM('charge', 'reversal', 'refund', 'opening', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."failure_reason" AS ENUM('NOT_HOME', 'LOCKED', 'REFUSED', 'WRONG_ADDRESS', 'OUT_OF_STOCK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'upi', 'later');--> statement-breakpoint
CREATE TYPE "public"."stock_place" AS ENUM('depot', 'trip', 'customer', 'damaged', 'outside');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('planned', 'on_route', 'ended', 'reconciled');--> statement-breakpoint
CREATE TABLE "account_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"attempt_id" uuid,
	"reason" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_type" "account_entry_type" NOT NULL,
	"delta_paise" integer NOT NULL,
	"balance_after_paise" integer NOT NULL,
	"payment_id" uuid,
	"reverses_entry_id" bigint
);
--> statement-breakpoint
CREATE TABLE "can_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"attempt_id" uuid,
	"reason" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_type" "can_entry_type" NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reverses_entry_id" bigint,
	CONSTRAINT "can_ledger_balance_ck" CHECK (balance_after >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"outcome" "attempt_outcome" NOT NULL,
	"failure_reason" "failure_reason",
	"note" text,
	"full_delivered" integer DEFAULT 0 NOT NULL,
	"empty_collected" integer DEFAULT 0 NOT NULL,
	"extra_empties" integer DEFAULT 0 NOT NULL,
	"charge_paise" integer DEFAULT 0 NOT NULL,
	"deposit_cans" integer DEFAULT 0 NOT NULL,
	"deposit_paise" integer DEFAULT 0 NOT NULL,
	"payment_method" "payment_method",
	"amount_collected_paise" integer DEFAULT 0 NOT NULL,
	"over_credit_limit" boolean DEFAULT false NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"happened_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_action_id" uuid NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	CONSTRAINT "delivery_attempts_counts_ck" CHECK (full_delivered >= 0 and empty_collected >= 0 and extra_empties >= 0 and charge_paise >= 0 and deposit_paise >= 0 and amount_collected_paise >= 0)
);
--> statement-breakpoint
CREATE TABLE "deposit_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"attempt_id" uuid,
	"reason" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_type" "deposit_entry_type" NOT NULL,
	"delta_paise" integer NOT NULL,
	"delta_cans" integer NOT NULL,
	"balance_after_paise" integer NOT NULL,
	"cover_after_cans" integer NOT NULL,
	"reverses_entry_id" bigint
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_paise" integer NOT NULL,
	"reference" text,
	"collected_by" uuid NOT NULL,
	"trip_id" uuid,
	"attempt_id" uuid,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK (amount_paise > 0 and method <> 'later')
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"from_place" "stock_place" NOT NULL,
	"from_state" "can_state" NOT NULL,
	"to_place" "stock_place" NOT NULL,
	"to_state" "can_state" NOT NULL,
	"qty" integer NOT NULL,
	"kind" text NOT NULL,
	"trip_id" uuid,
	"attempt_id" uuid,
	"customer_id" uuid,
	"note" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_qty_ck" CHECK (qty > 0)
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "trip_status" DEFAULT 'planned' NOT NULL,
	"load_full" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"expected_full" integer,
	"expected_empty" integer,
	"expected_cash_paise" integer,
	"return_full" integer,
	"return_empty" integer,
	"return_damaged" integer,
	"cash_handed_paise" integer,
	"end_note" text,
	"reconciled_by" uuid,
	"reconciled_at" timestamp with time zone,
	"reconcile_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "cans_held" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "deposit_held_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "deposit_cover_cans" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "balance_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stop_seq" integer;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_attempt_id_delivery_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."delivery_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "can_ledger" ADD CONSTRAINT "can_ledger_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "can_ledger" ADD CONSTRAINT "can_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "can_ledger" ADD CONSTRAINT "can_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "can_ledger" ADD CONSTRAINT "can_ledger_attempt_id_delivery_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."delivery_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "can_ledger" ADD CONSTRAINT "can_ledger_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger" ADD CONSTRAINT "deposit_ledger_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger" ADD CONSTRAINT "deposit_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger" ADD CONSTRAINT "deposit_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger" ADD CONSTRAINT "deposit_ledger_attempt_id_delivery_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."delivery_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger" ADD CONSTRAINT "deposit_ledger_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_attempt_id_delivery_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."delivery_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_attempt_id_delivery_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."delivery_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_ledger_customer_idx" ON "account_ledger" USING btree ("customer_id","id");--> statement-breakpoint
CREATE INDEX "can_ledger_customer_idx" ON "can_ledger" USING btree ("customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempts_action_uq" ON "delivery_attempts" USING btree ("supplier_id","client_action_id");--> statement-breakpoint
CREATE INDEX "delivery_attempts_order_idx" ON "delivery_attempts" USING btree ("order_id","recorded_at");--> statement-breakpoint
CREATE INDEX "delivery_attempts_trip_idx" ON "delivery_attempts" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "deposit_ledger_customer_idx" ON "deposit_ledger" USING btree ("customer_id","id");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_trip_idx" ON "payments" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "stock_movements_supplier_idx" ON "stock_movements" USING btree ("supplier_id","at");--> statement-breakpoint
CREATE INDEX "stock_movements_trip_idx" ON "stock_movements" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_staff_date_uq" ON "trips" USING btree ("supplier_id","staff_user_id","date");--> statement-breakpoint
CREATE INDEX "trips_supplier_date_idx" ON "trips" USING btree ("supplier_id","date");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_trip_idx" ON "orders" USING btree ("trip_id","stop_seq");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_balances_ck" CHECK (cans_held >= 0 and deposit_held_paise >= 0 and deposit_cover_cans >= 0 and credit_limit_paise >= 0);--> statement-breakpoint
-- Ledgers are append-only: a mistake is corrected by a reversing entry, never by editing.
CREATE TRIGGER can_ledger_append_only
  BEFORE UPDATE OR DELETE ON can_ledger
  FOR EACH ROW EXECUTE FUNCTION wtrdrop_forbid_change();
--> statement-breakpoint
CREATE TRIGGER can_ledger_no_truncate
  BEFORE TRUNCATE ON can_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION wtrdrop_forbid_change();
--> statement-breakpoint
-- Ledgers are append-only: a mistake is corrected by a reversing entry, never by editing.
CREATE TRIGGER deposit_ledger_append_only
  BEFORE UPDATE OR DELETE ON deposit_ledger
  FOR EACH ROW EXECUTE FUNCTION wtrdrop_forbid_change();
--> statement-breakpoint
CREATE TRIGGER deposit_ledger_no_truncate
  BEFORE TRUNCATE ON deposit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION wtrdrop_forbid_change();
--> statement-breakpoint
-- Ledgers are append-only: a mistake is corrected by a reversing entry, never by editing.
CREATE TRIGGER account_ledger_append_only
  BEFORE UPDATE OR DELETE ON account_ledger
  FOR EACH ROW EXECUTE FUNCTION wtrdrop_forbid_change();
--> statement-breakpoint
CREATE TRIGGER account_ledger_no_truncate
  BEFORE TRUNCATE ON account_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION wtrdrop_forbid_change();
--> statement-breakpoint
-- Ledgers are append-only: a mistake is corrected by a reversing entry, never by editing.
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION wtrdrop_forbid_change();
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_truncate
  BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION wtrdrop_forbid_change();
