/**
 * Copia as duas planilhas do Andre para dentro do app, linha a linha e na mesma ordem (D141).
 *
 *   - `Claude de DRE - Dynamics Data 2026.xlsx`, aba `DRE Geral` → aba DRE do app
 *   - `Fluxo de Caixa - 2026.xlsx`, abas `Income`, `Expenses` e `Summary` → aba Fluxo
 *
 * **Não toca em razão nenhum.** Grava só na `planilha_linhas`, que é uma cópia do que ele
 * digitou. A conta corrente continua batendo com o extrato, e as telas calculadas pelo razão
 * continuam existindo, atrás de um botão.
 *
 * Cada relatório é regravado inteiro: apaga o que havia daquela entidade e escreve de novo,
 * numa transação. Uma cópia parcial seria pior que nenhuma — a tela misturaria duas versões
 * da planilha sem dizer.
 *
 *   npm run importar:planilhas              # mostra o que copiaria, não grava
 *   npm run importar:planilhas -- --aplicar # grava
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx, type Sheet } from "@/lib/import/xlsx";
import { lerDre, lerFluxo, type Leitura } from "@/lib/planilha";

loadEnvLocal();

const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const DRE = "docs/reference/Claude de DRE - Dynamics Data 2026.xlsx";
const FLUXO = "docs/reference/Fluxo de Caixa - 2026.xlsx";
const aplicar = process.argv.includes("--aplicar");

function aba(abas: Sheet[], nome: string, arquivo: string): Sheet {
  const achada = abas.find((s) => s.name === nome);
  if (!achada) throw new Error(`a aba \`${nome}\` não está em ${arquivo}`);
  return achada;
}

const dreAbas = readXlsx(readFileSync(DRE));
const fluxoAbas = readXlsx(readFileSync(FLUXO));

const relatorios: { relatorio: "dre" | "fluxo"; arquivo: string; leitura: Leitura }[] = [
  { relatorio: "dre", arquivo: basename(DRE), leitura: lerDre(aba(dreAbas, "DRE Geral", DRE)) },
  {
    relatorio: "fluxo",
    arquivo: basename(FLUXO),
    leitura: lerFluxo({
      income: aba(fluxoAbas, "Income", FLUXO),
      expenses: aba(fluxoAbas, "Expenses", FLUXO),
      summary: aba(fluxoAbas, "Summary", FLUXO),
    }),
  },
];

console.log(`\n${BOLD}As suas planilhas, copiadas para o app${RESET}\n`);
for (const { relatorio, arquivo, leitura } of relatorios) {
  const porTipo = new Map<string, number>();
  for (const l of leitura.linhas) porTipo.set(l.tipo, (porTipo.get(l.tipo) ?? 0) + 1);
  const resumo = [...porTipo].map(([t, n]) => `${n} ${t}`).join(", ");
  console.log(
    `${BOLD}${relatorio === "dre" ? "DRE" : "Fluxo"}${RESET} ${DIM}— ${arquivo}${RESET}\n` +
      `  ${leitura.linhas.length} linhas (${resumo})`,
  );
  const primeira = leitura.linhas[0];
  const ultima = leitura.linhas[leitura.linhas.length - 1];
  if (primeira && ultima) {
    console.log(`  ${DIM}da "${primeira.rotulo}" até a "${ultima.rotulo}", na ordem da planilha${RESET}`);
  }
  if (leitura.ignoradas.length > 0) {
    console.log(`  ${YELLOW}${leitura.ignoradas.length} célula(s) de mês com texto, não copiadas:${RESET}`);
    for (const c of leitura.ignoradas) console.log(`    ${c}`);
  }
}

if (!aplicar) {
  console.log(`\n${DIM}nada foi gravado. Rode com --aplicar para copiar.${RESET}\n`);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  await sql.begin(async (tx) => {
    for (const { relatorio, arquivo, leitura } of relatorios) {
      await tx`delete from planilha_linhas where entity_id = ${entity.id} and relatorio = ${relatorio}`;
      for (const l of leitura.linhas) {
        await tx`
          insert into planilha_linhas
            (entity_id, relatorio, ordem, tipo, rotulo, detalhe, valores, total, arquivo)
          values
            (${entity.id}, ${relatorio}, ${l.ordem}, ${l.tipo}, ${l.rotulo}, ${l.detalhe},
             ${l.valores}::text[], ${l.total}, ${arquivo})`;
      }
    }
  });

  const contagem = await sql<{ relatorio: string; n: string }[]>`
    select relatorio, count(*)::text as n from planilha_linhas
     where entity_id = ${entity.id} group by 1 order by 1`;
  console.log(
    `\n${GREEN}${BOLD}Copiado.${RESET} ` +
      contagem.map((c) => `${c.relatorio}: ${c.n} linhas`).join(" · ") +
      `\n${DIM}Nenhum lançamento do razão foi tocado.${RESET}\n`,
  );
} finally {
  await sql.end();
}
