/**
 * O fluxo pronto: a planilha do Andre nos meses que ela tem, o cálculo do app nos meses que
 * ela ainda não tem — nas mesmas linhas, na mesma ordem (D146).
 *
 * Pedido em 05/10: *"quero que o sistema já faça tudo sozinho e me dê o fluxo pronto"*. A aba
 * Fluxo mostrava a cópia da planilha, e a cópia para em agosto de propósito (D141): setembro
 * em diante é o que o app gera a partir do extrato. Sem isto, mandar o extrato de setembro
 * não mudava nada na aba que ele abre.
 *
 * Regras, todas a favor de não inventar número:
 *
 *   - **Célula que a planilha tem nunca é sobrescrita.** Só se preenche o que está vazio,
 *     nos meses pedidos.
 *   - **Cada conta vai para uma linha só.** `Time - Interno` e `Time - Freelancers` são as
 *     duas a `6.10` no app — o razão não sabe separar —, então o valor vai inteiro para a
 *     primeira, e a segunda fica vazia, em vez de o dinheiro aparecer duas vezes.
 *   - **O grupo é a soma das linhas dele**, como na planilha.
 *   - **O que não tem linha na planilha não some:** vira `Outras entradas` / `Outras saídas
 *     (sem linha na planilha)`, e é isso que faz o total da seção continuar sendo o do banco.
 *   - **Os totais são os do razão**: entradas e saídas do `buildCashFlow`, o mesmo relatório
 *     da tela que bate com o extrato; `Net savings` é entradas menos saídas, `Ending balance`
 *     é o saldo de fechamento.
 *   - `Inadimplencia`, `Valor Itaú` e `Diferença` são conferências que ele faz à mão — ficam
 *     vazias nos meses do app.
 *
 * Puro: recebe as linhas e o relatório, devolve as linhas com `calculado` marcando cada
 * célula que veio do app, para a tela poder mostrar a diferença.
 */

import type { CashFlowReport, CashFlowRow } from "@/lib/cash-flow";
import { contasDaLinha } from "@/lib/linhas-da-planilha";
import { fromNumeric, toNumeric, type Cents } from "@/lib/money";
import type { LinhaPlanilha } from "@/lib/planilha";

export type LinhaDoFluxo = LinhaPlanilha & {
  /** Um por mês: esta célula veio do cálculo do app, e não da planilha. */
  calculado: boolean[];
};

/** A linha agrupada dos sócios (D112) não tem código; ela responde pelos dois. */
const SOCIOS_CODES = ["6.11", "99.04"];

const MESES = 12;

/** Linhas que são saldo num dia, não movimento num mês — não têm total. */
const SALDOS = new Set(["Ending balance", "Valor Itaú", "Diferença"]);

function porCodigo(rows: readonly CashFlowRow[], sociosLabel: string): Map<string, CashFlowRow> {
  const mapa = new Map<string, CashFlowRow>();
  for (const row of rows) {
    if (row.label === sociosLabel) for (const c of SOCIOS_CODES) mapa.set(c, row);
    else if (row.code) mapa.set(row.code, row);
  }
  return mapa;
}

/** O índice de cada período do relatório no ano (janeiro = 0). */
function indiceDoMes(report: CashFlowReport): Map<number, number> {
  const mapa = new Map<number, number>();
  report.periods.forEach((period, i) => mapa.set(Number(period.slice(5, 7)) - 1, i));
  return mapa;
}

export function preencherComORazao(
  linhas: readonly LinhaPlanilha[],
  report: CashFlowReport,
  meses: readonly number[],
  sociosLabel: string,
): LinhaDoFluxo[] {
  const alvo = new Set(meses);
  const noRelatorio = indiceDoMes(report);
  const entradas = report.sections.find((s) => s.key === "in");
  const saidas = report.sections.find((s) => s.key === "out");
  const porSecao = {
    in: porCodigo(entradas?.rows ?? [], sociosLabel),
    out: porCodigo(saidas?.rows ?? [], sociosLabel),
  };

  const valorDoRelatorio = (serie: readonly Cents[] | undefined, mes: number): Cents | null => {
    const i = noRelatorio.get(mes);
    return i === undefined || serie === undefined ? null : (serie[i] ?? 0n);
  };

  const saida: LinhaDoFluxo[] = [];
  let secao: "in" | "out" | "resumo" | null = null;
  // As linhas que já reclamaram cada linha do relatório, por seção — uma conta, uma linha.
  let reclamadas = new Set<CashFlowRow>();
  // Soma do que as linhas desta seção levaram, por mês — o resto vai para "Outras".
  let levado: Cents[] = Array.from({ length: MESES }, () => 0n);
  // As linhas do grupo aberto, para o grupo ser a soma delas.
  let grupoAberto: LinhaDoFluxo | null = null;
  let filhosDoGrupo: LinhaDoFluxo[] = [];

  const fecharGrupo = () => {
    if (!grupoAberto) return;
    for (const m of alvo) {
      if (grupoAberto.valores[m] !== null || !noRelatorio.has(m)) continue;
      const soma = filhosDoGrupo.reduce(
        (a, f) => a + (f.calculado[m] && f.valores[m] ? fromNumeric(f.valores[m] as string) : 0n),
        0n,
      );
      grupoAberto.valores[m] = toNumeric(soma);
      grupoAberto.calculado[m] = true;
    }
    grupoAberto = null;
    filhosDoGrupo = [];
  };

  const empurrar = (l: LinhaPlanilha, calculado?: boolean[]): LinhaDoFluxo => {
    const nova: LinhaDoFluxo = {
      ...l,
      valores: [...l.valores],
      calculado: calculado ?? Array.from({ length: MESES }, () => false),
    };
    saida.push(nova);
    return nova;
  };

  const linhaDeSobra = (rotulo: string, total: readonly Cents[] | undefined) => {
    const valores: (string | null)[] = Array.from({ length: MESES }, () => null);
    const calculado = Array.from({ length: MESES }, () => false);
    let temAlgo = false;
    for (const m of alvo) {
      const t = valorDoRelatorio(total, m);
      if (t === null) continue;
      const sobra = t - (levado[m] ?? 0n);
      valores[m] = toNumeric(sobra);
      calculado[m] = true;
      if (sobra !== 0n) temAlgo = true;
    }
    if (temAlgo) {
      // No nível dos grupos, não dentro do último: não é parte de `Imposto` nem de `Other`.
      empurrar({ ordem: 0, tipo: "grupo", rotulo, detalhe: null, valores, total: null }, calculado);
    }
  };

  for (const original of linhas) {
    if (original.tipo === "secao") {
      fecharGrupo();
      secao = original.rotulo === "Income" ? "in" : original.rotulo === "Expenses" ? "out" : "resumo";
      reclamadas = new Set();
      levado = Array.from({ length: MESES }, () => 0n);
      empurrar(original);
      continue;
    }

    if (original.tipo === "grupo") {
      fecharGrupo();
      grupoAberto = empurrar(original);
      continue;
    }

    if (original.tipo === "total" && (secao === "in" || secao === "out")) {
      fecharGrupo();
      const secaoDoRelatorio = secao === "in" ? entradas : saidas;
      linhaDeSobra(
        secao === "in" ? "Outras entradas (sem linha na planilha)" : "Outras saídas (sem linha na planilha)",
        secaoDoRelatorio?.totals,
      );
      const linha = empurrar(original);
      for (const m of alvo) {
        if (linha.valores[m] !== null) continue;
        const v = valorDoRelatorio(secaoDoRelatorio?.totals, m);
        if (v === null) continue;
        linha.valores[m] = toNumeric(v);
        linha.calculado[m] = true;
      }
      continue;
    }

    if (secao === "resumo" && original.rotulo === "Ending balance") {
      // `Net savings` é entradas menos saídas; o saldo também anda por transferência que não
      // se cancela dentro do relatório — hoje, só a abertura de uma conta no meio do ano
      // (D147). Sem esta linha, o `Ending balance` pularia mais do que a soma explica.
      const transferencias = report.sections.find((s) => s.key === "transfer")?.totals;
      const valores: (string | null)[] = Array.from({ length: MESES }, () => null);
      const calculado = Array.from({ length: MESES }, () => false);
      let temAlgo = false;
      for (const m of alvo) {
        const v = valorDoRelatorio(transferencias, m);
        if (v === null) continue;
        valores[m] = toNumeric(v);
        calculado[m] = true;
        if (v !== 0n) temAlgo = true;
      }
      if (temAlgo) {
        empurrar(
          {
            ordem: 0,
            tipo: "total",
            rotulo: "Transferências e saldo de abertura de conta",
            detalhe: null,
            valores,
            total: null,
          },
          calculado,
        );
      }
    }

    const linha = empurrar(original);

    if (secao === "resumo") {
      const serie =
        linha.rotulo === "Net savings"
          ? report.operating
          : linha.rotulo === "Ending balance"
            ? report.closing
            : undefined;
      for (const m of alvo) {
        if (linha.valores[m] !== null || !serie) continue;
        const v = valorDoRelatorio(serie, m);
        if (v === null) continue;
        linha.valores[m] = toNumeric(v);
        linha.calculado[m] = true;
      }
      continue;
    }

    if (secao === "in" || secao === "out") {
      const rows = (contasDaLinha(linha.rotulo) ?? [])
        .map((c) => porSecao[secao as "in" | "out"].get(c))
        .filter((r): r is CashFlowRow => r !== undefined && !reclamadas.has(r));
      const distintas = [...new Set(rows)];
      for (const r of distintas) reclamadas.add(r);
      for (const m of alvo) {
        if (linha.valores[m] !== null) continue;
        const i = noRelatorio.get(m);
        if (i === undefined) continue;
        const v = distintas.reduce((a, r) => a + (r.values[i] ?? 0n), 0n);
        linha.valores[m] = distintas.length === 0 ? null : toNumeric(v);
        linha.calculado[m] = distintas.length > 0;
        levado[m] = (levado[m] ?? 0n) + v;
      }
      if (grupoAberto) filhosDoGrupo.push(linha);
    }
  }
  fecharGrupo();

  // O total de cada linha passa a incluir os meses calculados; quem não tinha total segue sem.
  // Saldo não se soma: `Ending balance` de agosto mais o de setembro não é número nenhum.
  return saida.map((l, i) => {
    const total = SALDOS.has(l.rotulo)
      ? null
      : l.tipo === "secao" || l.total === null || !l.calculado.some(Boolean)
        ? l.total
        : toNumeric(l.valores.reduce((a, v) => a + (v === null ? 0n : fromNumeric(v)), 0n));
    return { ...l, ordem: i + 1, total };
  });
}
