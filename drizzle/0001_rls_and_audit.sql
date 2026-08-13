-- Row Level Security, audit triggers, and the self-references Drizzle cannot express.
--
-- Every business table is readable and writable only through `user_entities`. The app
-- always connects with the user's JWT (DECISIONS D16), so these policies are the real
-- boundary between the two entities — not the UI.
--
-- SPEC §11.6 is tested against this file, not against the screens.

-- ---------------------------------------------------------------------------
-- Self-references
-- ---------------------------------------------------------------------------

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parent_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_parent_contract_id_fk"
  FOREIGN KEY ("parent_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL;--> statement-breakpoint

-- A POC report must belong to the same entity as its contract; percent is a percentage.
ALTER TABLE "poc_reports"
  ADD CONSTRAINT "poc_reports_percent_range"
  CHECK ("percent_complete_cumulative" >= 0 AND "percent_complete_cumulative" <= 100);--> statement-breakpoint

-- A recognition period is always the first day of a month (DECISIONS D18).
ALTER TABLE "recognition_entries"
  ADD CONSTRAINT "recognition_entries_period_is_month_start"
  CHECK (date_trunc('month', "period") = "period");--> statement-breakpoint

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_service_period_is_month_start"
  CHECK (date_trunc('month', "service_period") = "service_period");--> statement-breakpoint

ALTER TABLE "poc_reports"
  ADD CONSTRAINT "poc_reports_period_is_month_start"
  CHECK (date_trunc('month', "period") = "period");--> statement-breakpoint

-- Cash amounts are stored as magnitude plus a direction; keep them non-negative so a
-- sign error cannot quietly flip an inflow into an outflow.
ALTER TABLE "cash_entries"
  ADD CONSTRAINT "cash_entries_amount_non_negative"
  CHECK ("amount" >= 0);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Access helper
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER on purpose: this reads `user_entities`, which is itself protected by
-- RLS. Without it, every policy that calls this would recurse into that table's own
-- policy. It is STABLE and takes no user input beyond the entity id.
CREATE OR REPLACE FUNCTION public.has_entity_access(target_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_entities
    WHERE user_entities.entity_id = target_entity_id
      AND user_entities.user_id = auth.uid()
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.has_entity_access(uuid) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.has_entity_access(uuid) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- You see an entity only if you are linked to it.
CREATE POLICY "entities_access" ON "entities"
  FOR ALL TO authenticated
  USING (public.has_entity_access(id))
  WITH CHECK (public.has_entity_access(id));--> statement-breakpoint

-- You see your own membership rows, and nobody else's.
CREATE POLICY "user_entities_self" ON "user_entities"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());--> statement-breakpoint

-- Every other business table follows the same shape.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'accounts',
    'categories',
    'clients',
    'people',
    'contracts',
    'contract_items',
    'invoices',
    'poc_reports',
    'statement_imports',
    'staged_transactions',
    'cash_entries',
    'transfer_pairs',
    'recognition_entries',
    'categorization_rules'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated '
      'USING (public.has_entity_access(entity_id)) '
      'WITH CHECK (public.has_entity_access(entity_id))',
      target || '_entity_access', target
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- The audit log is append-only from the application's point of view: readable for the
-- entities you can reach, insertable by the triggers, never updatable or deletable.
CREATE POLICY "audit_log_read" ON "audit_log"
  FOR SELECT TO authenticated
  USING (entity_id IS NULL OR public.has_entity_access(entity_id));--> statement-breakpoint

CREATE POLICY "audit_log_insert" ON "audit_log"
  FOR INSERT TO authenticated
  WITH CHECK (entity_id IS NULL OR public.has_entity_access(entity_id));--> statement-breakpoint

-- Nothing reaches these tables without a logged-in user.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

-- SPEC §6: every mutation of cash_entries, recognition_entries, contracts and
-- categorization_rules is logged. Since nothing is ever locked (DECISIONS D-A), this
-- trail is the only thing that makes editing history safe.
CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id text;
  row_entity uuid;
BEGIN
  actor_id := COALESCE(auth.uid()::text, 'system');
  row_entity := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_id ELSE NEW.entity_id END,
    NULL
  );

  INSERT INTO public.audit_log (entity_id, actor, action, table_name, row_id, before_json, after_json)
  VALUES (
    row_entity,
    actor_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "cash_entries_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "cash_entries"
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint

CREATE TRIGGER "recognition_entries_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "recognition_entries"
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint

CREATE TRIGGER "contracts_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "contracts"
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint

CREATE TRIGGER "categorization_rules_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "categorization_rules"
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "cash_entries_touch"
  BEFORE UPDATE ON "cash_entries"
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint

CREATE TRIGGER "recognition_entries_touch"
  BEFORE UPDATE ON "recognition_entries"
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
