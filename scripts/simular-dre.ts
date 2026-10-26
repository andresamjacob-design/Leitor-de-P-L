/**
 * A DRE pronta (D163) medida contra a planilha: apaga janeiro a agosto da cópia, deixa o app
 * preencher, e compara linha a linha e nos totais. Mostra também o que o app põe nos meses
 * que a planilha não tem.
 *
 *   npm run simular:dre
 *   npm run simular:dre -- --detalhe     # cada diferença, mês a mês
 *
 * Só lê.
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { montarDadosDaDre, preencherDreComApp, type LinhaDeCompetencia } from "@/lib/dre-da-planilha";
import type { LinhaPlanilha, TipoLinha } from "@/lib/planilha";
import { formatBRL, fromNumeric, type Cents } from "@/lib/money";

loadEnvLocal();
const DETALHE = process.argv.includes("--detalhe");
const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const copia = await sql<{ ordem: number; tipo: TipoLinha; rotulo: string; detalhe: string | null; valores: (string | null)[]; total: string | null }[]>`
    select ordem, tipo, rotulo, detalhe, valores, total from planilha_linhas
     where entity_id = ${entity!.id} and relatorio = 'dre' order by ordem`;
  const linhas: LinhaPlanilha[] = copia.map((l) => ({
    ...l,
    valores: Array.from({ length: 12 }, (_, i) => {
      const v = l.valores[i];
      return v === undefined || v === null || v === "NULL" ? null : String(v);
    }),
  }));
  const ultimoCopiado = Math.max(-1, ...linhas.flatMap((l) => l.valores.flatMap((v, i) => (v === null ? [] : [i]))));

  const competencia = await sql<{ mes: number; kind: "revenue" | "cost"; amount: string; codigo: string | null; nome: string | null; tipo: string | null }[]>`
    select extract(month from r.period)::int - 1 as mes, r.kind, r.amount::text, c.code as codigo, k.name as nome, k.type as tipo
      from recognition_entries r
      left join categories c on c.id = r.category_id
      left join contracts k on k.id = r.contract_id
     where r.entity_id = ${entity!.id} and r.period between '2026-01-01' and '2026-12-01'`;
  const dados = montarDadosDaDre(
    competencia.map((r): LinhaDeCompetencia => ({
      mes: r.mes, kind: r.kind, amount: fromNumeric(r.amount), codigo: r.codigo,
      contrato: r.nome && r.tipo ? { nome: r.nome, tipo: r.tipo } : null,
    })),
  );

  // O último mês com extrato completo: o mês do último lançamento, se ele vai até o fim; senão o anterior.
  const [linhaUltimo] = await sql<{ ultimo: string }[]>`
    select max(ce.occurred_on)::text as ultimo from cash_entries ce join accounts a on a.id = ce.account_id
     where ce.entity_id = ${entity!.id} and a.type in ('bank', 'cash')`;
  const ultimo = linhaUltimo!.ultimo;
  const mesUltimo = Number(ultimo.slice(5, 7)) - 1;
  const fimDoMes = new Date(Date.UTC(2026, mesUltimo + 1, 0)).toISOString().slice(0, 10);
  const ultimoFechado = ultimo >= fimDoMes ? mesUltimo : mesUltimo - 1;

  // 1. A simulação: janeiro até o último copiado, apagados e refeitos pelo app.
  const meses = Array.from({ length: ultimoCopiado + 1 }, (_, i) => i);
  const apagadas = linhas.map((l) => ({ ...l, valores: l.valores.map(() => null) }));
  const simulada = preencherDreComApp(apagadas, dados, meses, ultimoFechado).linhas;
  const porRotulo = new Map<string, typeof simulada>();
  for (const l of simulada) porRotulo.set(`${l.rotulo}|${l.detalhe ?? ""}`, [...(porRotulo.get(`${l.rotulo}|${l.detalhe ?? ""}`) ?? []), l]);
  const usadas = new Map<string, number>();

  const c = (v: string | null | undefined): Cents => (v === null || v === undefined ? 0n : fromNumeric(v));
  let celulas = 0, iguais = 0;
  const totais: string[] = [];
  const linhasRuins: { rotulo: string; fecha: number; n: number; diffs: string[]; soma: Cents }[] = [];
  for (const orig of linhas) {
    const chave = `${orig.rotulo}|${orig.detalhe ?? ""}`;
    const k = usadas.get(chave) ?? 0;
    usadas.set(chave, k + 1);
    const app = porRotulo.get(chave)?.[k];
    if (!app || orig.tipo === "secao") continue;
    let fecha = 0, n = 0; const diffs: string[] = []; let soma = 0n;
    for (const m of meses) {
      if (orig.tipo === "percentual") continue;
      const p = c(orig.valores[m]), a = c(app.valores[m]);
      if (p === 0n && a === 0n) continue;
      n++; celulas++;
      // Arredondamento da planilha: ela guarda 5833.333333 e o app soma centavos.
      if ((p - a < 0n ? a - p : p - a) <= 2n) { fecha++; iguais++; } else { diffs.push(`${NOMES[m]} ${formatBRL(a - p)}`); soma += a - p; }
    }
    if (orig.tipo === "total") totais.push(`  ${orig.rotulo.padEnd(34)} ${fecha}/${n}${diffs.length ? `   app − planilha: ${diffs.join(", ")}` : ""}`);
    else if (fecha < n) linhasRuins.push({ rotulo: `${orig.rotulo}${orig.detalhe?.startsWith("Projeto") ? " (projeto)" : ""}`, fecha, n, diffs, soma });
  }

  console.log(`\nA DRE pronta contra a sua planilha, ${NOMES[0]}–${NOMES[ultimoCopiado]} (a cópia apagada e refeita pelo app)\n`);
  console.log(`  ${iguais} de ${celulas} células fecham (até 2 centavos de arredondamento).\n`);
  console.log("Totais:");
  console.log(totais.join("\n"));
  console.log(`\n${linhasRuins.length} linha(s) com diferença:`);
  for (const l of linhasRuins.sort((a, b) => (b.soma < 0n ? -b.soma : b.soma) > (a.soma < 0n ? -a.soma : a.soma) ? 1 : -1)) {
    console.log(`  ${l.rotulo.slice(0, 34).padEnd(34)} ${l.fecha}/${l.n}   soma ${formatBRL(l.soma)}${DETALHE ? `\n     ${l.diffs.join(", ")}` : ""}`);
  }
  for (const extra of simulada.filter((l) => l.rotulo.includes("sem linha na planilha"))) {
    console.log(`  ${extra.rotulo}: ${meses.map((m) => `${NOMES[m]} ${formatBRL(c(extra.valores[m]))}`).filter((t) => !t.endsWith(" R$ 0,00")).join(", ") || "nada"}`);
  }

  // 2. O que o app põe depois da cópia.
  const depois = Array.from({ length: Math.max(0, ultimoFechado - ultimoCopiado) }, (_, i) => ultimoCopiado + 1 + i);
  const pronta = preencherDreComApp(linhas, dados, depois, ultimoFechado);
  console.log(`\nDepois da cópia: ${depois.map((m) => NOMES[m]).join(", ") || "nenhum mês"} (extrato completo até ${NOMES[ultimoFechado]}; último lançamento ${ultimo})`);
  for (const l of pronta.linhas.filter((x) => x.tipo === "total" || x.tipo === "percentual" || x.rotulo === "Impostos" || x.rotulo.includes("sem linha"))) {
    console.log(`  ${l.rotulo.slice(0, 34).padEnd(34)} ${depois.map((m) => (l.valores[m] === null ? "aguarda" : l.tipo === "percentual" ? `${(Number(l.valores[m]) * 100).toFixed(1)}%` : formatBRL(c(l.valores[m])))).join("   ")}`);
  }
  for (const [m, quais] of pronta.aguardando) console.log(`  ${NOMES[m]} espera o extrato de ${NOMES[m + 1]}: ${quais.join(", ")}`);
  console.log("");
} finally {
  await sql.end();
}
