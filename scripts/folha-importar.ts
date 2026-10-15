/**
 * Importa a aba `Colaboradores` para o cadastro de folha do app, uma vez (D161).
 *
 * Cada linha da aba vira uma `folha_linhas`, e os 12 meses viram o menor histórico que os
 * reproduz (`historicoDosMeses`): salário que continua vira `vigente`, mês quebrado vira
 * `so_no_mes`. Daqui em diante a fonte é o app, e a planilha deixa de ser lida.
 *
 * Travas, as duas obrigatórias para gravar:
 *   - o histórico de cada linha reproduz **cada célula** dos 12 meses;
 *   - a soma das linhas bate, mês a mês, com a linha de total da própria aba (como na D120).
 * E recusa se o cadastro já tiver linhas — importar duas vezes dobraria a folha.
 *
 *   npm run folha:importar              # mostra
 *   npm run folha:importar -- --ensaio  # grava numa transação revertida
 *   npm run folha:importar -- --aplicar
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { conferir, historicoDosMeses } from "@/lib/folha";
import { formatBRL, toNumeric, type Cents } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const PLANILHA = "docs/reference/DRE - Dynamics Data 2026 (24-09).xlsx";
const PRIMEIRA_COLUNA = 7;
const LINHA_TOTAIS = 3;
const PRIMEIRA_PESSOA = 5;
const MESES = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`);
/** Os três sócios, pelos rótulos que a própria aba usa (D110, D120). */
const SOCIOS = new Set(["CUSTODIO", "JACOB", "LEONARDO"]);

const centavos = (bruto: unknown): Cents => {
  const t = String(bruto ?? "").trim();
  return t === "" ? 0n : BigInt(Math.round(Number(t) * 100));
};
const texto = (bruto: unknown) => {
  const t = String(bruto ?? "").trim();
  return t === "" ? null : t;
};

class Rollback extends Error {}

const aba = readXlsx(new Uint8Array(readFileSync(PLANILHA))).find((s) => s.name === "Colaboradores");
if (!aba) throw new Error("aba `Colaboradores` não encontrada");

const totais = MESES.map((_, i) => centavos(aba.rows[LINHA_TOTAIS]?.[PRIMEIRA_COLUNA + i]));
type Linha = {
  nome: string; cliente: string | null; squad: string | null; cargo: string | null;
  vinculo: string | null; conta: "6.10" | "6.11"; valores: Cents[]; historico: ReturnType<typeof historicoDosMeses>;
};
const linhas: Linha[] = [];
for (let i = PRIMEIRA_PESSOA; i < aba.rows.length; i++) {
  const row = aba.rows[i];
  if (!row || texto(row[0]) === null) continue;
  const cliente = texto(row[2]);
  const colaborador = texto(row[5]);
  const socio = colaborador === null && SOCIOS.has((cliente ?? "").toUpperCase());
  const valores = MESES.map((_, j) => centavos(row[PRIMEIRA_COLUNA + j]));
  const historico = historicoDosMeses(MESES, valores);
  const erradas = conferir(MESES, valores, historico);
  if (erradas.length > 0) throw new Error(`linha ${i + 1}: o histórico não reproduz ${erradas.join(", ")}`);
  linhas.push({
    nome: colaborador ?? cliente ?? `linha ${i + 1}`,
    cliente,
    squad: texto(row[3]),
    cargo: texto(row[6]),
    vinculo: texto(row[0]),
    conta: socio ? ("6.11" as const) : ("6.10" as const),
    valores,
    historico,
  });
}

console.log(`\nA aba Colaboradores → o cadastro de folha\n`);
let tudoBate = true;
MESES.forEach((mes, i) => {
  const soma = linhas.reduce((a, l) => a + (l.valores[i] ?? 0n), 0n);
  const ok = soma === totais[i];
  if (!ok) tudoBate = false;
  console.log(`  ${mes.slice(0, 7)}  ${formatBRL(soma).padStart(16)}  aba ${formatBRL(totais[i]!).padStart(16)}  ${ok ? "ok" : `difere ${formatBRL(soma - totais[i]!)}`}`);
});
const vigentes = linhas.reduce((a, l) => a + l.historico.filter((h) => h.tipo === "vigente").length, 0);
const doMes = linhas.reduce((a, l) => a + l.historico.filter((h) => h.tipo === "so_no_mes").length, 0);
console.log(`\n  ${linhas.length} linhas · ${vigentes} salários vigentes · ${doMes} valores só do mês · cada célula reproduzida`);
if (!tudoBate) throw new Error("a soma das linhas não bate com o total da própria aba");

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });
try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const [ja] = await sql<{ n: number }[]>`select count(*)::int as n from folha_linhas where entity_id = ${entity!.id}`;
  if ((ja?.n ?? 0) > 0) throw new Error(`o cadastro já tem ${ja!.n} linha(s) — importar de novo dobraria a folha`);

  const write = async (db: postgres.TransactionSql) => {
    for (const [ordem, l] of linhas.entries()) {
      const [nova] = await db<{ id: string }[]>`
        insert into folha_linhas (entity_id, nome, cliente, squad, cargo, vinculo, conta, ordem)
        values (${entity!.id}, ${l.nome}, ${l.cliente}, ${l.squad}, ${l.cargo}, ${l.vinculo}, ${l.conta}, ${ordem + 1})
        returning id`;
      for (const h of l.historico) {
        await db`insert into folha_valores (entity_id, linha_id, mes, valor, tipo)
                 values (${entity!.id}, ${nova!.id}, ${h.mes}, ${toNumeric(h.valor)}, ${h.tipo})`;
      }
    }
    // A prova pelo banco: a mesma regra, no SQL, dá o total da aba em todos os meses.
    for (const [i, mes] of MESES.entries()) {
      const [r] = await db<{ t: string }[]>`
        select coalesce(sum(valor_da_folha(id, ${mes}::date)), 0)::text as t from folha_linhas where entity_id = ${entity!.id}`;
      if (centavos(r!.t) !== totais[i]) throw new Error(`no banco, ${mes} dá ${r!.t}; a aba diz ${formatBRL(totais[i]!)}`);
    }
    console.log("  conferido no banco: os 12 meses dão o total da aba");
  };

  if (!APPLY && !REHEARSE) console.log("\nnada foi gravado. --ensaio para ensaiar, --aplicar para gravar.\n");
  else if (REHEARSE) {
    await sql.begin(async (tx) => { await write(tx); throw new Rollback(); })
      .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    console.log("ensaio: revertido, nada foi gravado.\n");
  } else {
    await sql.begin(write);
    console.log("gravado.\n");
  }
} finally {
  await sql.end();
}
