CREATE TABLE "planilha_linhas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"relatorio" text NOT NULL,
	"ordem" integer NOT NULL,
	"tipo" text NOT NULL,
	"rotulo" text NOT NULL,
	"detalhe" text,
	"valores" text[] NOT NULL,
	"total" text,
	"arquivo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planilha_linhas_ordem_key" UNIQUE("entity_id","relatorio","ordem")
);
--> statement-breakpoint
ALTER TABLE "planilha_linhas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "planilha_linhas" ADD CONSTRAINT "planilha_linhas_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planilha_linhas_entity_idx" ON "planilha_linhas" USING btree ("entity_id","relatorio");--> statement-breakpoint

-- A mesma forma de toda tabela de negócio (0001): só quem tem acesso à entidade vê a cópia
-- da planilha dela. A planilha tem CNPJ de cliente e saldo, e não é menos sensível que o
-- razão por ser uma cópia.
CREATE POLICY "planilha_linhas_entity_access" ON "planilha_linhas"
  FOR ALL TO authenticated
  USING (public.has_entity_access(entity_id))
  WITH CHECK (public.has_entity_access(entity_id));
