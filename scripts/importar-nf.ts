/**
 * Copia o bloco `Emissão de NF` da aba `Clientes` para o app (D170).
 *
 * Grava só na `planilha_linhas`, com `relatorio = 'nf'`, regravando o bloco inteiro numa
 * transação — como o `importar:planilhas`, e separado dele para não regravar DRE e Fluxo
 * quando só a emissão de NF mudou. Nenhum lançamento do razão é tocado.
 *
 *   npm run importar:nf                          # mostra o que copiaria, não grava
 *   npm run importar:nf -- --aplicar             # grava
 *   npm run importar:nf -- --fluxo <arquivo>     # outra versão da planilha
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { lerEmissaoDeNf } from "@/lib/nf-da-planilha";

loadEnvLocal();

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

const argumento = (nome: string): string | undefined => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FLUXO = argumento("--fluxo") ?? "docs/reference/Fluxo de Caixa - 2026 (07-10).xlsx";
const aplicar = process.argv.includes("--aplicar");

const aba = readXlsx(readFileSync(FLUXO)).find((s) => s.name === "Clientes");
if (!aba) throw new Error(`a aba \`Clientes\` não está em ${FLUXO}`);
const leitura = lerEmissaoDeNf(aba);
const arquivo = basename(FLUXO);

const [cabecalho, ...clientes] = leitura.linhas;
const meses = cabecalho?.valores ?? [];
console.log(`\n${BOLD}Emissão de NF${RESET} ${DIM}— ${arquivo}${RESET}`);
console.log(
  `  ${clientes.length} linhas de cliente, de ${meses[0]?.slice(0, 7)} a ${meses[meses.length - 1]?.slice(0, 7)}`,
);
const semCnpj = clientes.filter((l) => !/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(l.detalhe ?? ""));
console.log(`  ${DIM}${clientes.length - semCnpj.length} com CNPJ na planilha, ${semCnpj.length} sem${RESET}`);
if (leitura.ignoradas.length > 0) {
  console.log(`  ${YELLOW}${leitura.ignoradas.length} célula(s) de mês com texto, não copiadas:${RESET}`);
  for (const c of leitura.ignoradas) console.log(`    ${c}`);
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
    await tx`delete from planilha_linhas where entity_id = ${entity.id} and relatorio = 'nf'`;
    for (const l of leitura.linhas) {
      await tx`
        insert into planilha_linhas
          (entity_id, relatorio, ordem, tipo, rotulo, detalhe, valores, total, arquivo)
        values
          (${entity.id}, 'nf', ${l.ordem}, ${l.tipo}, ${l.rotulo}, ${l.detalhe},
           ${l.valores}::text[], ${l.total}, ${arquivo})`;
    }
  });
  console.log(
    `\n${GREEN}${BOLD}Copiado.${RESET} ${leitura.linhas.length} linhas em \`nf\`.` +
      `\n${DIM}Nenhum lançamento do razão foi tocado.${RESET}\n`,
  );
} finally {
  await sql.end();
}
