ALTER TYPE "public"."account_entry_type" ADD VALUE 'deposit_refund';--> statement-breakpoint
CREATE TYPE "public"."refund_method" AS ENUM('cash', 'upi', 'adjust');--> statement-breakpoint
CREATE TABLE "deposit_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"cans" integer NOT NULL,
	"amount_paise" integer NOT NULL,
	"method" "refund_method" NOT NULL,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_refunds_amount_ck" CHECK (amount_paise > 0 and cans > 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reversed_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reverse_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verified_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_refunds_client_request_uq" ON "deposit_refunds" USING btree ("supplier_id","client_request_id");--> statement-breakpoint
CREATE INDEX "deposit_refunds_customer_idx" ON "deposit_refunds" USING btree ("customer_id","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_paid_on_idx" ON "payments" USING btree ("supplier_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_client_request_uq" ON "payments" USING btree ("supplier_id","client_request_id") WHERE client_request_id is not null;--> statement-breakpoint
-- Payments recorded before Phase 6 get their day (India time).
UPDATE "payments" SET "paid_on" = ("created_at" AT TIME ZONE 'Asia/Kolkata')::date WHERE "paid_on" IS NULL;
