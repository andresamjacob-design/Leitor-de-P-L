/**
 * O cadastro de folha (D161), lido e escrito com a sessão de quem está logado: o RLS decide
 * quem pode — ver com qualquer acesso, mudar só com "Ver e editar" ou "Administrador".
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, toNumeric, type Cents } from "@/lib/money";
import type { TipoFolha, ValorFolha } from "@/lib/folha";

export type LinhaFolha = {
  id: string;
  nome: string;
  cliente: string | null;
  squad: string | null;
  cargo: string | null;
  vinculo: string | null;
  conta: "6.10" | "6.11";
  ordem: number;
  historico: (ValorFolha & { id: string })[];
};

export async function listarFolha(entityId: string): Promise<LinhaFolha[]> {
  const supabase = await createClient();
  const [linhas, valores] = await Promise.all([
    supabase.from("folha_linhas").select("id, nome, cliente, squad, cargo, vinculo, conta, ordem")
      .eq("entity_id", entityId).order("ordem"),
    supabase.from("folha_valores").select("id, linha_id, mes, valor, tipo")
      .eq("entity_id", entityId).order("mes").limit(5000),
  ]);
  if (linhas.error) throw new Error(`não foi possível carregar a folha: ${linhas.error.message}`);
  if (valores.error) throw new Error(`não foi possível carregar os salários: ${valores.error.message}`);

  const porLinha = new Map<string, LinhaFolha["historico"]>();
  for (const v of valores.data as { id: string; linha_id: string; mes: string; valor: string | number; tipo: TipoFolha }[]) {
    const lista = porLinha.get(v.linha_id) ?? [];
    lista.push({ id: v.id, mes: v.mes, valor: fromNumeric(String(v.valor)), tipo: v.tipo });
    porLinha.set(v.linha_id, lista);
  }
  return (linhas.data as Omit<LinhaFolha, "historico">[]).map((l) => ({ ...l, historico: porLinha.get(l.id) ?? [] }));
}

/** Grava (ou troca) o valor de uma linha num mês. */
export async function salvarValor(entityId: string, linhaId: string, mes: string, valor: Cents, tipo: TipoFolha) {
  const supabase = await createClient();
  // O banco também recusa (chave composta, 0011); aqui a mensagem sai clara.
  const { data: linha } = await supabase.from("folha_linhas").select("id")
    .eq("id", linhaId).eq("entity_id", entityId).maybeSingle();
  if (!linha) throw new Error("Essa linha não é da folha desta empresa.");
  const { error } = await supabase.from("folha_valores").upsert(
    { entity_id: entityId, linha_id: linhaId, mes, valor: toNumeric(valor), tipo },
    { onConflict: "linha_id,mes,tipo" },
  );
  if (error) throw new Error(mensagem(error.message));
}

/** Apaga e devolve o mês e o tipo do que foi apagado — `null` se não havia o que apagar. */
export async function removerValor(
  entityId: string,
  valorId: string,
): Promise<{ mes: string; tipo: TipoFolha } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("folha_valores").delete()
    .eq("id", valorId).eq("entity_id", entityId).select("mes, tipo").maybeSingle();
  if (error) throw new Error(mensagem(error.message));
  return (data as { mes: string; tipo: TipoFolha } | null) ?? null;
}

export async function criarLinha(
  entityId: string,
  linha: { nome: string; cliente: string | null; squad: string | null; cargo: string | null; conta: "6.10" | "6.11" },
): Promise<string> {
  const supabase = await createClient();
  const { data: ultima } = await supabase.from("folha_linhas").select("ordem").eq("entity_id", entityId)
    .order("ordem", { ascending: false }).limit(1);
  const ordem = ((ultima?.[0] as { ordem: number } | undefined)?.ordem ?? 0) + 1;
  const { data, error } = await supabase.from("folha_linhas")
    .insert({ entity_id: entityId, ...linha, ordem }).select("id").single();
  if (error) throw new Error(mensagem(error.message));
  return (data as { id: string }).id;
}

/** Regera a competência de folha mês a mês, pela mesma função do banco que o script usa. */
export async function regerarFolha(entityId: string, meses: readonly string[]) {
  const supabase = await createClient();
  for (const mes of meses) {
    const { error } = await supabase.rpc("regerar_folha", { target_entity_id: entityId, alvo_mes: mes });
    if (error) throw new Error(mensagem(error.message));
  }
}

function mensagem(m: string): string {
  if (/row-level security|permission|privilege|Só quem pode editar/i.test(m)) {
    return "Você pode ver a folha, mas não mudar. Peça a um administrador o acesso Ver e editar.";
  }
  return m;
}
