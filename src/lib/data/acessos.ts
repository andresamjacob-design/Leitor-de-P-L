/**
 * Quem pode ver e editar cada empresa (D155).
 *
 * As duas funções do banco (`listar_acessos`, `definir_acesso`) conferem lá dentro se quem
 * chama é administrador da empresa. Aqui só se chama com a sessão de quem está logado —
 * nenhuma chave de serviço (D16).
 */

import type { Papel } from "@/lib/papeis";
import { createClient } from "@/lib/supabase/server";

export type { Papel };

export type Acesso = {
  email: string;
  papel: Papel | null;
  situacao: "ativo" | "aguardando primeiro login" | "sem acesso";
  ultimoAcesso: string | null;
};

/** `null` quando quem pergunta não é administrador — a tela diz isso em vez de quebrar. */
export async function listarAcessos(entityId: string): Promise<Acesso[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("listar_acessos", { target_entity_id: entityId });
  if (error) {
    if (error.code === "42501") return null;
    throw new Error(`não foi possível carregar os acessos: ${error.message}`);
  }
  return (data as { email: string; role: Papel | null; situacao: Acesso["situacao"]; ultimo_acesso: string | null }[]).map(
    (r) => ({ email: r.email, papel: r.role, situacao: r.situacao, ultimoAcesso: r.ultimo_acesso }),
  );
}

/** `papel` nulo tira o acesso. Devolve a situação em que a pessoa ficou. */
export async function definirAcesso(entityId: string, email: string, papel: Papel | null): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("definir_acesso", {
    target_entity_id: entityId,
    alvo_email: email,
    novo_role: papel,
  });
  if (error) throw new Error(error.message);
  return String(data);
}
