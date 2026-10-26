/**
 * A folha cadastrada: o histórico de cada linha e o valor dela num mês (D161).
 *
 * Duas espécies de valor, as duas ditas pelo Andre:
 *
 *   - `vigente` — *"escrevemos o salário da pessoa no começo e já aplica para os outros
 *     meses, e podemos alterar em caso de um aumento"*. Vale daquele mês até o próximo.
 *   - `so_no_mes` — *"eu digito o valor do mês"*, para quem entra ou sai no meio. Vale só
 *     naquele mês e passa por cima do vigente.
 *
 * `valorNoMes` é a mesma regra da função `valor_da_folha` do banco (migration 0010), que é a
 * que gera a competência; esta existe para a tela e para a importação conferirem antes de
 * gravar.
 */

import type { Cents } from "@/lib/money";

export type TipoFolha = "vigente" | "so_no_mes";

/** `mes` é `YYYY-MM-01`. */
export type ValorFolha = { mes: string; valor: Cents; tipo: TipoFolha };

export function valorNoMes(historico: readonly ValorFolha[], mes: string): Cents {
  const doMes = historico.find((v) => v.tipo === "so_no_mes" && v.mes === mes);
  if (doMes) return doMes.valor;
  let atual: ValorFolha | undefined;
  for (const v of historico) {
    if (v.tipo === "vigente" && v.mes <= mes && (!atual || v.mes > atual.mes)) atual = v;
  }
  return atual?.valor ?? 0n;
}

/**
 * O menor histórico que reproduz os valores mensais de uma linha da planilha.
 *
 * Um valor que muda e **continua** no mês seguinte vira `vigente` (contratação, aumento,
 * saída para zero). Um valor que aparece num mês e **não** se repete no seguinte vira
 * `so_no_mes` — é o mês quebrado de quem entra ou sai, que o Andre digita. O último mês não
 * tem seguinte; se mudou, vira `vigente`.
 *
 * A reconstrução é exata por construção, e `conferir` prova isso na importação.
 */
export function historicoDosMeses(meses: readonly string[], valores: readonly Cents[]): ValorFolha[] {
  const historico: ValorFolha[] = [];
  let vigente: Cents = 0n;
  for (let i = 0; i < meses.length; i++) {
    const v = valores[i] ?? 0n;
    if (v === vigente) continue;
    const seguinte = i + 1 < meses.length ? (valores[i + 1] ?? 0n) : v;
    if (seguinte === v) {
      historico.push({ mes: meses[i]!, valor: v, tipo: "vigente" });
      vigente = v;
    } else {
      historico.push({ mes: meses[i]!, valor: v, tipo: "so_no_mes" });
    }
  }
  return historico;
}

/** Os meses em que o histórico não reproduz a planilha. Vazio é o único resultado aceitável. */
export function conferir(
  meses: readonly string[],
  valores: readonly Cents[],
  historico: readonly ValorFolha[],
): string[] {
  return meses.filter((mes, i) => valorNoMes(historico, mes) !== (valores[i] ?? 0n));
}
