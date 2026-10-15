-- O valor da folha e a linha dele são sempre da mesma empresa (D161).
--
-- O RLS confere o `entity_id` do próprio valor, não o da linha para onde ele aponta: quem
-- edita a empresa A poderia gravar um valor com `entity_id` de A e `linha_id` de uma linha de
-- B, e ele entraria na folha de B. A chave estrangeira passa a ser composta — linha e empresa
-- juntas —, e o banco recusa o cruzamento.
ALTER TABLE "folha_linhas" ADD CONSTRAINT "folha_linhas_id_entity_key" UNIQUE ("id", "entity_id");--> statement-breakpoint
ALTER TABLE "folha_valores" DROP CONSTRAINT "folha_valores_linha_fk";--> statement-breakpoint
ALTER TABLE "folha_valores" ADD CONSTRAINT "folha_valores_linha_mesma_empresa_fk"
  FOREIGN KEY ("linha_id", "entity_id") REFERENCES "public"."folha_linhas"("id", "entity_id") ON DELETE cascade;--> statement-breakpoint

-- E a regra do valor do mês só lê valores da empresa da própria linha.
CREATE OR REPLACE FUNCTION public.valor_da_folha(alvo_linha uuid, alvo_mes date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH l AS (SELECT entity_id FROM public.folha_linhas WHERE id = alvo_linha)
  SELECT coalesce(
    (SELECT v.valor FROM public.folha_valores v, l
      WHERE v.linha_id = alvo_linha AND v.entity_id = l.entity_id
        AND v.tipo = 'so_no_mes' AND v.mes = alvo_mes),
    (SELECT v.valor FROM public.folha_valores v, l
      WHERE v.linha_id = alvo_linha AND v.entity_id = l.entity_id
        AND v.tipo = 'vigente' AND v.mes <= alvo_mes
      ORDER BY v.mes DESC LIMIT 1),
    0
  );
$$;
