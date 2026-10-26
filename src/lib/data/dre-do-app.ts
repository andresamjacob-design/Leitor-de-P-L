/**
 * A competência do ano no formato da DRE pronta (D163): cada linha com o contrato (nome e tipo)
 * e o código da conta, para `montarDadosDaDre`.
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric } from "@/lib/money";
import { montarDadosDaDre, type DadosDaDre, type LinhaDeCompetencia } from "@/lib/dre-da-planilha";

type Linha = {
  period: string;
  kind: "revenue" | "cost";
  amount: string;
  categories: { code: string } | null;
  contracts: { name: string; type: string } | null;
};

export async function loadDreDoApp(entityId: string, ano: string): Promise<DadosDaDre> {
  const supabase = await createClient();
  // Paginado como o `listRecognition`: o PostgREST para em mil linhas, e o ano já passou disso.
  const PAGINA = 1000;
  const linhas: Linha[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("recognition_entries")
      .select("period, kind, amount, categories(code), contracts(name, type)")
      .eq("entity_id", entityId)
      .gte("period", `${ano}-01-01`)
      .lte("period", `${ano}-12-01`)
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(`não foi possível carregar a competência: ${error.message}`);
    const pagina = (data ?? []) as unknown as Linha[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return montarDadosDaDre(
    linhas.map(
      (l): LinhaDeCompetencia => ({
        mes: Number(l.period.slice(5, 7)) - 1,
        kind: l.kind,
        amount: fromNumeric(l.amount),
        codigo: l.categories?.code ?? null,
        contrato: l.contracts ? { nome: l.contracts.name, tipo: l.contracts.type } : null,
      }),
    ),
  );
}
