-- Acesso por domínio, com papéis que valem no banco (D155).
--
-- Até aqui (D20) só entrava quem fosse cadastrado à mão, e todo vínculo em `user_entities`
-- podia ler e escrever tudo — o papel existia na tabela e nenhuma política o lia.
--
--   1. Qualquer e-mail @ddgroup.com.br pode criar conta (login por código). Outro domínio,
--      não: o gatilho em `auth.users` recusa, então nem chamando a API do Supabase direto
--      com a chave pública se cria conta de fora. Quem já existe continua entrando.
--   2. Entrar não é ver. Os dados continuam atrás de `user_entities`, e agora o papel vale:
--      `viewer` lê, `member` lê e escreve, `owner` também libera outras pessoas.
--   3. Liberação por e-mail, antes do primeiro login, em `acessos_pendentes`: vira vínculo
--      quando a conta nasce.
--
-- Nenhuma chave de serviço (D16): as funções de administração são SECURITY DEFINER e
-- conferem, dentro do banco, se quem chama é `owner` daquela empresa.

CREATE TABLE "acessos_pendentes" (
	"email" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acessos_pendentes_pk" PRIMARY KEY("email","entity_id"),
	CONSTRAINT "acessos_pendentes_email_minusculo" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
ALTER TABLE "acessos_pendentes" ADD CONSTRAINT "acessos_pendentes_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade;--> statement-breakpoint
-- Sem política nenhuma: só as funções abaixo tocam nesta tabela.
ALTER TABLE "acessos_pendentes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O papel, lido pelas políticas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_entity_write(target_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_entities
     WHERE entity_id = target_entity_id
       AND user_id = auth.uid()
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
  SELECT EXISTS (
    SELECT 1 FROM public.user_entities
     WHERE entity_id = target_entity_id
       AND user_id = auth.uid()
       AND role = 'owner'
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.has_entity_write(uuid) FROM public;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_entity_admin(uuid) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.has_entity_write(uuid) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_entity_admin(uuid) TO authenticated;--> statement-breakpoint

-- Cada tabela de negócio troca a política única (ler e escrever) por duas: ler com qualquer
-- papel, escrever só com `owner` ou `member`. Políticas permissivas somam: num SELECT valem
-- as duas, num INSERT/UPDATE/DELETE só a de escrita.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'accounts', 'categories', 'clients', 'people', 'contracts', 'contract_items',
    'invoices', 'poc_reports', 'statement_imports', 'staged_transactions', 'cash_entries',
    'transfer_pairs', 'recognition_entries', 'categorization_rules', 'planilha_linhas'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_entity_access', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated '
      'USING (public.has_entity_access(entity_id))',
      target || '_read', target
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated '
      'USING (public.has_entity_write(entity_id)) '
      'WITH CHECK (public.has_entity_write(entity_id))',
      target || '_write', target
    );
  END LOOP;
END
$$;--> statement-breakpoint

DROP POLICY IF EXISTS "entities_access" ON "entities";--> statement-breakpoint
CREATE POLICY "entities_read" ON "entities"
  FOR SELECT TO authenticated
  USING (public.has_entity_access(id));--> statement-breakpoint
CREATE POLICY "entities_write" ON "entities"
  FOR ALL TO authenticated
  USING (public.has_entity_write(id))
  WITH CHECK (public.has_entity_write(id));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Quem pode criar conta, e o que a conta recebe ao nascer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.so_dominio_da_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR lower(NEW.email) NOT LIKE '%@ddgroup.com.br' THEN
    RAISE EXCEPTION 'Só e-mails @ddgroup.com.br podem criar acesso a este app.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.aplicar_acessos_pendentes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_entities (user_id, entity_id, role)
  SELECT NEW.id, p.entity_id, p.role
    FROM public.acessos_pendentes p
   WHERE p.email = lower(NEW.email)
  ON CONFLICT (user_id, entity_id) DO UPDATE SET role = excluded.role;
  DELETE FROM public.acessos_pendentes WHERE email = lower(NEW.email);
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "so_dominio_da_empresa" ON auth.users;--> statement-breakpoint
CREATE TRIGGER "so_dominio_da_empresa"
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.so_dominio_da_empresa();--> statement-breakpoint

DROP TRIGGER IF EXISTS "aplicar_acessos_pendentes" ON auth.users;--> statement-breakpoint
CREATE TRIGGER "aplicar_acessos_pendentes"
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.aplicar_acessos_pendentes();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Administração: listar e liberar, só para `owner`
-- ---------------------------------------------------------------------------

-- Quem tem acesso, quem está liberado e ainda não entrou, e quem da empresa já entrou sem
-- acesso — esse último grupo é o que o administrador mais precisa ver.
CREATE OR REPLACE FUNCTION public.listar_acessos(target_entity_id uuid)
RETURNS TABLE (email text, role public.user_role, situacao text, ultimo_acesso timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_entity_admin(target_entity_id) THEN
    RAISE EXCEPTION 'Só administradores veem os acessos.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT lower(u.email)::text, ue.role, 'ativo'::text, u.last_sign_in_at
      FROM public.user_entities ue JOIN auth.users u ON u.id = ue.user_id
     WHERE ue.entity_id = target_entity_id
    UNION ALL
    SELECT p.email, p.role, 'aguardando primeiro login'::text, NULL::timestamptz
      FROM public.acessos_pendentes p
     WHERE p.entity_id = target_entity_id
    UNION ALL
    SELECT lower(u.email)::text, NULL::public.user_role, 'sem acesso'::text, u.last_sign_in_at
      FROM auth.users u
     WHERE lower(u.email) LIKE '%@ddgroup.com.br'
       AND NOT EXISTS (SELECT 1 FROM public.user_entities ue
                        WHERE ue.user_id = u.id AND ue.entity_id = target_entity_id)
    ORDER BY 3, 1;
END;
$$;--> statement-breakpoint

-- `novo_role` nulo tira o acesso. Recusa deixar a empresa sem nenhum administrador.
CREATE OR REPLACE FUNCTION public.definir_acesso(target_entity_id uuid, alvo_email text, novo_role public.user_role)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  email_alvo text := lower(trim(alvo_email));
  alvo uuid;
  admins_restantes int;
BEGIN
  IF NOT public.is_entity_admin(target_entity_id) THEN
    RAISE EXCEPTION 'Só administradores liberam acesso.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO alvo FROM auth.users WHERE lower(email) = email_alvo;

  IF alvo IS NULL AND email_alvo NOT LIKE '%@ddgroup.com.br' THEN
    RAISE EXCEPTION 'Só e-mails @ddgroup.com.br podem ser liberados.' USING ERRCODE = 'check_violation';
  END IF;

  IF alvo IS NOT NULL AND (novo_role IS DISTINCT FROM 'owner') THEN
    SELECT count(*) INTO admins_restantes FROM public.user_entities
     WHERE entity_id = target_entity_id AND role = 'owner' AND user_id <> alvo;
    IF admins_restantes = 0 THEN
      RAISE EXCEPTION 'A empresa ficaria sem nenhum administrador.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF alvo IS NOT NULL THEN
    IF novo_role IS NULL THEN
      DELETE FROM public.user_entities WHERE user_id = alvo AND entity_id = target_entity_id;
      RETURN 'removido';
    END IF;
    INSERT INTO public.user_entities (user_id, entity_id, role)
    VALUES (alvo, target_entity_id, novo_role)
    ON CONFLICT (user_id, entity_id) DO UPDATE SET role = excluded.role;
    RETURN 'ativo';
  END IF;

  IF novo_role IS NULL THEN
    DELETE FROM public.acessos_pendentes WHERE email = email_alvo AND entity_id = target_entity_id;
    RETURN 'removido';
  END IF;
  INSERT INTO public.acessos_pendentes (email, entity_id, role, created_by)
  VALUES (email_alvo, target_entity_id, novo_role, auth.uid())
  ON CONFLICT (email, entity_id) DO UPDATE SET role = excluded.role;
  RETURN 'aguardando primeiro login';
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.listar_acessos(uuid) FROM public;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.definir_acesso(uuid, text, public.user_role) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.listar_acessos(uuid) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.definir_acesso(uuid, text, public.user_role) TO authenticated;
