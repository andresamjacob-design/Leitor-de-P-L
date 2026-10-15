/**
 * A cópia das planilhas do Andre, lida para as abas DRE e Fluxo (D141).
 *
 * Mesmo acesso que o resto: cliente Supabase com o JWT do usuário, e a RLS decide (D16).
 * Nada aqui calcula — a tela mostra o que a planilha diz, na ordem em que diz.
 */

import { createClient } from "@/lib/supabase/server";
import type { LinhaPlanilha, TipoLinha } from "@/lib/planilha";

export type Relatorio = "dre" | "fluxo";

export type PlanilhaCopiada = {
  linhas: LinhaPlanilha[];
  /** O arquivo de onde a cópia saiu, para a tela dizer de qual versão está falando. */
  arquivo: string | null;
  /** Quando foi copiada. `null` se nunca foi. */
  copiadaEm: string | null;
};

type Row = {
  ordem: number;
  tipo: TipoLinha;
  rotulo: string;
  detalhe: string | null;
  valores: (string | null)[];
  total: string | null;
  arquivo: string;
  created_at: string;
};

export async function loadPlanilha(entityId: string, relatorio: Relatorio): Promise<PlanilhaCopiada> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("planilha_linhas")
    .select("ordem, tipo, rotulo, detalhe, valores, total, arquivo, created_at")
    .eq("entity_id", entityId)
    .eq("relatorio", relatorio)
    .order("ordem", { ascending: true });

  if (error) throw new Error(`não consegui ler a cópia da planilha: ${error.message}`);

  const rows = (data ?? []) as Row[];
  return {
    linhas: rows.map((row) => ({
      ordem: row.ordem,
      tipo: row.tipo,
      rotulo: row.rotulo,
      detalhe: row.detalhe,
      valores: row.valores,
      total: row.total,
    })),
    arquivo: rows[0]?.arquivo ?? null,
    copiadaEm: rows[0]?.created_at ?? null,
  };
}
