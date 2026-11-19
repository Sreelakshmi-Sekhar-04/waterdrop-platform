CREATE TYPE "public"."order_channel" AS ENUM('app', 'office');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PLACED', 'ACCEPTED', 'REJECTED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RESCHEDULE_PENDING', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "closed_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"date" date NOT NULL,
	"window_id" uuid,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closed_days_uq" UNIQUE NULLS NOT DISTINCT("supplier_id","date","window_id")
);
--> statement-breakpoint
CREATE TABLE "customer_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price_paise" integer,
	"valid_from" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_prices_price_ck" CHECK (price_paise is null or price_paise >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ml" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"capacity_cans" integer NOT NULL,
	"days_of_week" integer[] NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_windows_time_ck" CHECK (start_time < end_time),
	CONSTRAINT "delivery_windows_capacity_ck" CHECK (capacity_cans >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_ordered" integer NOT NULL,
	"qty_delivered" integer,
	"unit_price_paise" integer NOT NULL,
	"deposit_per_can_paise" integer NOT NULL,
	"deposit_cans" integer NOT NULL,
	CONSTRAINT "order_items_qty_ck" CHECK (qty_ordered > 0)
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_no" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"address_snapshot" jsonb NOT NULL,
	"service_area_id" uuid NOT NULL,
	"window_id" uuid NOT NULL,
	"delivery_date" date NOT NULL,
	"status" "order_status" NOT NULL,
	"channel" "order_channel" NOT NULL,
	"total_qty" integer NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"delivery_charge_paise" integer NOT NULL,
	"deposit_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"note" text,
	"client_request_id" uuid NOT NULL,
	"placed_by" uuid NOT NULL,
	"capacity_held" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_money_ck" CHECK (subtotal_paise >= 0 and delivery_charge_paise >= 0 and deposit_paise >= 0 and total_paise = subtotal_paise + delivery_charge_paise + deposit_paise),
	CONSTRAINT "orders_qty_ck" CHECK (total_qty > 0)
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price_paise" integer NOT NULL,
	"valid_from" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_price_ck" CHECK (price_paise >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ml" text NOT NULL,
	"is_returnable_can" boolean DEFAULT true NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "window_bookings" (
	"supplier_id" uuid NOT NULL,
	"window_id" uuid NOT NULL,
	"date" date NOT NULL,
	"capacity_cans" integer,
	"reserved_cans" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "window_bookings_window_id_date_pk" PRIMARY KEY("window_id","date"),
	CONSTRAINT "window_bookings_reserved_ck" CHECK (reserved_cans >= 0),
	CONSTRAINT "window_bookings_capacity_ck" CHECK (capacity_cans is null or capacity_cans >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "delivery_charge_paise" integer;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "free_above_cans" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "next_order_no" integer DEFAULT 1001 NOT NULL;--> statement-breakpoint
ALTER TABLE "closed_days" ADD CONSTRAINT "closed_days_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_days" ADD CONSTRAINT "closed_days_window_id_delivery_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."delivery_windows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_days" ADD CONSTRAINT "closed_days_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_windows" ADD CONSTRAINT "delivery_windows_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_window_id_delivery_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."delivery_windows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "window_bookings" ADD CONSTRAINT "window_bookings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "window_bookings" ADD CONSTRAINT "window_bookings_window_id_delivery_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."delivery_windows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_prices_from_uq" ON "customer_prices" USING btree ("customer_id","product_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_windows_supplier_name_uq" ON "delivery_windows" USING btree ("supplier_id","name_en");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_product_uq" ON "order_items" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_supplier_no_uq" ON "orders" USING btree ("supplier_id","order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_request_uq" ON "orders" USING btree ("customer_id","client_request_id");--> statement-breakpoint
CREATE INDEX "orders_supplier_date_status_idx" ON "orders" USING btree ("supplier_id","delivery_date","status");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_from_uq" ON "product_prices" USING btree ("product_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "products_supplier_sku_uq" ON "products" USING btree ("supplier_id","sku");--> statement-breakpoint
-- Order history is evidence, like the audit log: insert only.
CREATE TRIGGER order_status_history_append_only
  BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION wtrdrop_forbid_change();
--> statement-breakpoint
CREATE TRIGGER order_status_history_no_truncate
  BEFORE TRUNCATE ON order_status_history
  FOR EACH STATEMENT EXECUTE FUNCTION wtrdrop_forbid_change();
