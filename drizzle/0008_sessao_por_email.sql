-- Só sessão que provou controle do e-mail vê dados, e auditoria só por quem escreve (D156).
--
-- A 0007 confere o **texto** do e-mail na criação da conta, não se a pessoa controla a caixa
-- postal. Com a chave pública, qualquer um pode chamar o cadastro com senha usando
-- `andre.jacob@ddgroup.com.br` — e a conta nasceria com a liberação de administrador que já
-- está pendente para esse endereço. Se o projeto confirmar e-mail automaticamente, a sessão
-- viria na hora; se não, a senha do atacante continuaria valendo depois que o dono
-- confirmasse pelo código.
--
-- O JWT do Supabase diz como a sessão foi aberta (`amr`), e o valor vem de
-- `auth.mfa_amr_claims`, gravado por sessão — sobrevive à renovação do token. Medido em
-- 14/10: a única sessão existente é `email/signup` (link de confirmação), e as duas contas
-- Gmail têm senha. A regra aceita os métodos que exigem abrir a caixa postal e recusa
-- `password`: quem entra só com senha não vê dado nenhum, tenha o vínculo que tiver.

CREATE OR REPLACE FUNCTION public.sessao_por_email()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) AS metodo
     WHERE metodo ->> 'method' IN ('otp', 'magiclink', 'email/signup', 'invite', 'recovery')
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.sessao_por_email() FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.sessao_por_email() TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.has_entity_access(target_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.sessao_por_email() AND EXISTS (
    SELECT 1 FROM public.user_entities
     WHERE entity_id = target_entity_id AND user_id = auth.uid()
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.has_entity_write(target_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.sessao_por_email() AND EXISTS (
    SELECT 1 FROM public.user_entities
     WHERE entity_id = target_entity_id AND user_id = auth.uid()
       AND role IN ('owner', 'member')
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_entity_admin(target_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.sessao_por_email() AND EXISTS (
    SELECT 1 FROM public.user_entities
     WHERE entity_id = target_entity_id AND user_id = auth.uid()
       AND role = 'owner'
  );
$$;--> statement-breakpoint

-- A auditoria é escrita pelos gatilhos (SECURITY DEFINER, não passam por aqui). Pela API,
-- inserir à mão era permitido a qualquer vínculo — um `viewer` forjaria registro.
DROP POLICY IF EXISTS "audit_log_insert" ON "audit_log";--> statement-breakpoint
CREATE POLICY "audit_log_insert" ON "audit_log"
  FOR INSERT TO authenticated
  WITH CHECK (entity_id IS NOT NULL AND public.has_entity_write(entity_id));
