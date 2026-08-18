/**
 * Põe o CNPJ do extrato no cliente que já existe.
 *
 * O `propose:receipts` se recusa a decidir isto sozinho, e com razão (D87): **41 dos 72
 * clientes estão sem documento**, e casar nome de empresa automaticamente cria duplicata —
 * `Windlog` e `BRAZIL WIND LOGISTICS AGENCIAMENTO INTERNACIONAL` são a mesma empresa e não
 * se parecem; `MS Tecnologia` e `FULANO MARKETING E TECNOLOGIA` se parecem e não são.
 * Cliente duplicado estraga a margem por cliente em silêncio.
 *
 * Então a decisão vem de fora, e este script só a executa. A tabela abaixo é a memória
 * dessas respostas: cada linha foi confirmada pelo Andre, e fica registrada aqui para a
 * próxima conversa não perguntar de novo.
 *
 * Depois de ligado, o CNPJ passa a valer para sempre: o `propose:receipts` reconhece a
 * contraparte, e se o cliente tiver contratos apontando todos para a mesma conta de
 * receita, a categoria sai junto sem ninguém escolher nada.
 *
 *   npm run vincular
 *   npm run vincular -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/**
 * Confirmado pelo Andre em 18/08/2026.
 *
 * `cliente` é o nome exato como está cadastrado. `contraparte` é como o **extrato** escreve
 * a empresa — e é de lá que o documento é lido, nunca digitado aqui: um CNPJ escrito à mão
 * num arquivo de código é um número que ninguém confere e que cola no cliente errado em
 * silêncio. `porque` fica registrado porque daqui a seis meses ninguém lembra por que
 * "Windlog" e "BRAZIL WIND LOGISTICS" são a mesma coisa.
 */
const CONFIRMADOS: readonly { cliente: string; contraparte: string; porque: string }[] = [
  {
    cliente: "Windlog",
    contraparte: "BRAZIL WIND LOGISTICS%",
    porque: "Windlog é o nome curto de BRAZIL WIND LOGISTICS AGENCIAMENTO INTERNACIONAL",
  },
  {
    cliente: "Ciclo",
    contraparte: "CICLO INTELIGENCIA%",
    porque: "Ciclo é CICLO INTELIGENCIA EM E - COMMERCE; também é fornecedora, ver D83",
  },
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  console.log(`\n${BOLD}${CONFIRMADOS.length} vínculos confirmados${RESET}\n`);

  const pendentes: { id: string; cliente: string; documento: string }[] = [];

  for (const link of CONFIRMADOS) {
    const [cliente] = await sql<{ id: string; name: string; tax_id: string | null }[]>`
      select id, name, tax_id from clients where name = ${link.cliente}`;

    if (!cliente) {
      console.log(`  ${YELLOW}?${RESET} cliente “${link.cliente}” não existe — nada a fazer`);
      continue;
    }

    // O documento vem do extrato. Se a contraparte aparece com mais de um CNPJ, isso é
    // ambiguidade e não se resolve escolhendo um — é exatamente o caso de parar.
    const documentos = await sql<{ doc: string }[]>`
      select distinct regexp_replace(counterparty_tax_id, '\D', '', 'g') as doc
      from cash_entries
      where upper(coalesce(counterparty_name, '')) like ${link.contraparte}
        and counterparty_tax_id is not null`;

    console.log(`  ${BOLD}${cliente.name}${RESET} ${DIM}← ${link.contraparte}${RESET}`);
    console.log(`     ${DIM}${link.porque}${RESET}`);

    if (documentos.length === 0) {
      console.log(`     ${YELLOW}nenhum lançamento com esse nome no extrato${RESET}\n`);
      continue;
    }
    if (documentos.length > 1) {
      console.log(
        `     ${YELLOW}esse nome aparece com ${documentos.length} documentos diferentes — não dá para escolher${RESET}\n`,
      );
      continue;
    }

    const doc = documentos[0]!.doc;

    // A partir daqui é o **documento** que manda, não o nome. A Ciclo aparece no extrato
    // com três grafias — `CICLO INTELIGENCIA`, `CICLO - ASSESSORIA…`, `CICLO - A. M. I.
    // D. P.` — todas no mesmo CNPJ. Contar pelo nome contaria um terço do movimento.
    const [mov] = await sql<
      { entrou: string; entradas: string; saiu: string; saidas: string; grafias: string }[]
    >`
      select coalesce(sum(amount) filter (where direction = 'in'), 0)  as entrou,
             count(*) filter (where direction = 'in')                  as entradas,
             coalesce(sum(amount) filter (where direction = 'out'), 0) as saiu,
             count(*) filter (where direction = 'out')                 as saidas,
             count(distinct counterparty_name)                         as grafias
      from cash_entries
      where regexp_replace(coalesce(counterparty_tax_id, ''), '\D', '', 'g') = ${doc}`;

    const entrou = fromNumeric(mov?.entrou ?? "0");
    const saiu = fromNumeric(mov?.saiu ?? "0");

    console.log(
      `     documento …${doc.slice(-6)}   ` +
        `entrou ${formatBRL(entrou).padStart(14)} em ${mov?.entradas ?? 0} linhas` +
        `   ·   saiu ${formatBRL(saiu).padStart(14)} em ${mov?.saidas ?? 0} linhas`,
    );
    if (Number(mov?.grafias ?? 1) > 1) {
      console.log(
        `     ${DIM}o extrato escreve esse CNPJ de ${mov?.grafias} maneiras — por isso o documento manda, e não o nome${RESET}`,
      );
    }

    if (cliente.tax_id) {
      const atual = cliente.tax_id.replace(/\D/g, "");
      if (atual === doc) {
        console.log(`     ${GREEN}já vinculado${RESET}\n`);
      } else {
        console.log(
          `     ${YELLOW}já tem outro documento (…${atual.slice(-6)}) — não será sobrescrito${RESET}\n`,
        );
      }
      continue;
    }

    pendentes.push({ id: cliente.id, cliente: cliente.name, documento: doc });
    console.log(`     ${GREEN}vai receber o documento${RESET}\n`);
  }

  if (pendentes.length === 0) {
    console.log(`${DIM}nada a fazer.${RESET}\n`);
  } else if (!APPLY) {
    console.log(`${DIM}nada foi gravado. Rode com --aplicar.${RESET}\n`);
  } else {
    await sql.begin(async (db) => {
      for (const item of pendentes) {
        await db`update clients set tax_id = ${item.documento} where id = ${item.id}`;
      }
    });
    console.log(`${GREEN}${BOLD}${pendentes.length} clientes ganharam documento.${RESET}`);
    console.log(
      `${DIM}Rode ${RESET}npm run propose:receipts${DIM} — a contraparte agora é reconhecida, e a\n` +
        `conta de receita sai junto quando os contratos do cliente apontam todos para a mesma.${RESET}\n`,
    );
  }
} finally {
  await sql.end();
}
