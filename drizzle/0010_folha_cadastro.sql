-- A folha cadastrada no app (D161).
--
-- O Andre em 15/10: *"no DRE a folha é predefinida no começo do ano e só muda se algum salário
-- se alterar… escrevemos o salário da pessoa no começo e já aplica para os outros meses, e
-- podemos alterar em caso de um aumento"*. E para entrada ou saída no meio do mês: *"eu digito
-- o valor do mês"*.
--
--   - `folha_linhas` é uma linha da folha como na aba `Colaboradores`: pessoa + cliente + squad.
--     A mesma pessoa pode ter duas linhas (dois clientes), como na planilha.
--   - `folha_valores` é o histórico de cada linha: `vigente` vale daquele mês em diante, até o
--     próximo `vigente`; `so_no_mes` vale só naquele mês e passa por cima do vigente.
--   - `regerar_folha(empresa, mês)` escreve a competência do mês a partir disso. É uma função
--     só, chamada pelo script e pela tela, e roda com a sessão de quem chama (SECURITY
--     INVOKER): o RLS decide quem pode.

CREATE TYPE "public"."folha_tipo" AS ENUM('vigente', 'so_no_mes');--> statement-breakpoint

CREATE TABLE "folha_linhas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"cliente" text,
	"squad" text,
	"cargo" text,
	"vinculo" text,
	"conta" text NOT NULL,
	"ordem" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folha_linhas_conta" CHECK ("conta" IN ('6.10', '6.11'))
);
--> statement-breakpoint
ALTER TABLE "folha_linhas" ADD CONSTRAINT "folha_linhas_entity_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade;--> statement-breakpoint

CREATE TABLE "folha_valores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"linha_id" uuid NOT NULL,
	"mes" date NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"tipo" "folha_tipo" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folha_valores_um_por_mes" UNIQUE ("linha_id", "mes", "tipo"),
	CONSTRAINT "folha_valores_dia_1" CHECK (extract(day FROM "mes") = 1),
	CONSTRAINT "folha_valores_nao_negativo" CHECK ("valor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "folha_valores" ADD CONSTRAINT "folha_valores_entity_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "folha_valores" ADD CONSTRAINT "folha_valores_linha_fk" FOREIGN KEY ("linha_id") REFERENCES "public"."folha_linhas"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "folha_valores_linha_mes_idx" ON "folha_valores" USING btree ("linha_id", "mes");--> statement-breakpoint

ALTER TABLE "folha_linhas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "folha_valores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- As mesmas duas políticas de toda tabela de negócio desde a 0007: ler com qualquer vínculo,
-- escrever só `owner`/`member` — e as duas exigem sessão aberta pelo e-mail (0008).
CREATE POLICY "folha_linhas_read" ON "folha_linhas" FOR SELECT TO authenticated
  USING (public.has_entity_access(entity_id));--> statement-breakpoint
CREATE POLICY "folha_linhas_write" ON "folha_linhas" FOR ALL TO authenticated
  USING (public.has_entity_write(entity_id)) WITH CHECK (public.has_entity_write(entity_id));--> statement-breakpoint
CREATE POLICY "folha_valores_read" ON "folha_valores" FOR SELECT TO authenticated
  USING (public.has_entity_access(entity_id));--> statement-breakpoint
CREATE POLICY "folha_valores_write" ON "folha_valores" FOR ALL TO authenticated
  USING (public.has_entity_write(entity_id)) WITH CHECK (public.has_entity_write(entity_id));--> statement-breakpoint

-- Salário é o que mais precisa de histórico de quem mudou o quê.
CREATE TRIGGER "folha_valores_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "folha_valores"
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint

-- O valor de uma linha num mês: o `so_no_mes` daquele mês, se houver; senão o último
-- `vigente` até ele; senão zero.
CREATE OR REPLACE FUNCTION public.valor_da_folha(alvo_linha uuid, alvo_mes date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT valor FROM public.folha_valores
      WHERE linha_id = alvo_linha AND tipo = 'so_no_mes' AND mes = alvo_mes),
    (SELECT valor FROM public.folha_valores
      WHERE linha_id = alvo_linha AND tipo = 'vigente' AND mes <= alvo_mes
      ORDER BY mes DESC LIMIT 1),
    0
  );
$$;--> statement-breakpoint

-- Escreve a competência de folha de um mês a partir do cadastro, trocando a que houver. E
-- tira o espelho de caixa dos pagamentos de folha daquele mês (D120): o custo de folha passa
-- a nascer do cadastro, e espelho mais competência seria o mesmo custo duas vezes.
CREATE OR REPLACE FUNCTION public.regerar_folha(target_entity_id uuid, alvo_mes date)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inicio date := date_trunc('month', alvo_mes)::date;
  total numeric := 0;
BEGIN
  -- Pelo app (papel `authenticated`) vale o papel da pessoa; pelo script, direto no banco
  -- com o DATABASE_URL, não há sessão de usuário e a trava não se aplica.
  IF current_user = 'authenticated' AND NOT public.has_entity_write(target_entity_id) THEN
    RAISE EXCEPTION 'Só quem pode editar gera a folha.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.recognition_entries r
   USING public.categories c
   WHERE r.category_id = c.id AND r.entity_id = target_entity_id
     AND r.source = 'accrual' AND r.period = inicio AND c.code IN ('6.10', '6.11');

  DELETE FROM public.recognition_entries r
   USING public.categories c, public.cash_entries e
   WHERE r.category_id = c.id AND r.cash_entry_id = e.id
     AND r.entity_id = target_entity_id AND r.source = 'cash_mirror'
     AND c.code IN ('6.10', '6.11')
     AND e.occurred_on >= inicio AND e.occurred_on < (inicio + interval '1 month');

  INSERT INTO public.recognition_entries (entity_id, period, category_id, kind, amount, source, notes)
  SELECT l.entity_id, inicio, c.id, 'cost', v.valor, 'accrual', 'folha: ' || l.nome
    FROM public.folha_linhas l
    JOIN public.categories c ON c.entity_id = l.entity_id AND c.code = l.conta
    CROSS JOIN LATERAL (SELECT public.valor_da_folha(l.id, inicio) AS valor) v
   WHERE l.entity_id = target_entity_id AND v.valor > 0;

  SELECT coalesce(sum(amount), 0) INTO total
    FROM public.recognition_entries r JOIN public.categories c ON c.id = r.category_id
   WHERE r.entity_id = target_entity_id AND r.source = 'accrual' AND r.period = inicio
     AND c.code IN ('6.10', '6.11');
  RETURN total;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.valor_da_folha(uuid, date) FROM public;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.regerar_folha(uuid, date) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valor_da_folha(uuid, date) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.regerar_folha(uuid, date) TO authenticated;
