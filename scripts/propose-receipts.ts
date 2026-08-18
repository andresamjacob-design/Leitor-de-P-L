/**
 * Descobre de quem é o dinheiro que entrou e ainda não tem conta.
 *
 * Sobram 67 entradas sem categoria no razão, R$ 1,3 milhão. A regra que as separa vive em
 * `src/lib/receipts.ts`, pura e testada; aqui só se carrega o banco e se grava o que ela
 * autoriza.
 *
 * O que ele faz, e o que se recusa a fazer:
 *
 *   - **Liga o cliente pelo CNPJ.** É identidade, não texto (D40), e não tem margem de erro.
 *   - **Não cadastra cliente nenhum.** Parecia seguro cadastrar com o nome legal do
 *     extrato, e não é: **41 dos 72 clientes estão sem documento**, e o dry run mostrou
 *     `CICLO - A. M. I. D. P. E-COMMERCE` a caminho de virar um segundo "Ciclo", que já
 *     existe com contrato. O mesmo vale para `UMI SAN`. Casar nome de empresa é
 *     exatamente a ambiguidade que o `propose-parties` se recusa a resolver sozinho —
 *     `Windlog` × `BRAZIL WIND LOGISTICS` escapa de qualquer casador, e
 *     `MS Tecnologia` × `FULANO MARKETING E TECNOLOGIA` casa sendo coisas diferentes.
 *     Duplicar cliente estraga a margem por cliente em silêncio, então os CNPJs sem dono
 *     saem como lista de decisão, não como escrita.
 *   - **Só propõe conta de receita quando ela é inequívoca** — todos os contratos do
 *     cliente na mesma conta, ou o valor batendo com a mensalidade de um contrato só.
 *     Cliente com projeto *e* retainer fica sem conta de propósito, e aparece na lista de
 *     decisões no fim.
 *   - **Nunca trata CPF como cliente.** Pessoa física que manda dinheiro é devolução ou
 *     reembolso, não receita — são as duas devoluções do Ricardo e um Roberto, R$ 170 mil
 *     que virariam receita fantasma.
 *
 * Categorizar uma entrada não cria competência (`planCashMirror` só espelha custo, e
 * receita nasce de contrato e NF), então nada aqui move a DRE. O `verify:reconcile`
 * continua fechando em zero depois de aplicar — e vale rodá-lo para confirmar.
 *
 *   npm run propose:receipts
 *   npm run propose:receipts -- --ensaio
 *   npm run propose:receipts -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";
import { judgeReceipt, VERDICT_LABEL } from "@/lib/receipts";
import type { ClientContract, KnownClient, ReceiptVerdict } from "@/lib/receipts";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

type Row = {
  id: string;
  entity_id: string;
  occurred_on: string;
  amount: string;
  description: string;
  counterparty_name: string | null;
  doc: string;
};

try {
  const rows = await sql<Row[]>`
    select e.id, e.entity_id, e.occurred_on, e.amount, e.description, e.counterparty_name,
           regexp_replace(coalesce(e.counterparty_tax_id, ''), '\D', '', 'g') as doc
    from cash_entries e
    join accounts a on a.id = e.account_id
    where a.type in ('bank', 'cash', 'investment')
      and e.direction = 'in'
      and e.category_id is null
    order by e.amount desc`;

  // Clientes com documento, e os contratos de cada um com a conta de receita já
  // resolvida: `contracts.category_id` vence o tipo (migration 0005), e o tipo decide
  // quando ela é nula — 3.01 para retainer, 3.02 para projeto.
  const clientRows = await sql<
    {
      client_id: string;
      client_name: string;
      doc: string;
      contract_id: string | null;
      contract_name: string | null;
      contract_type: "retainer" | "project" | null;
      revenue_category_id: string | null;
      monthly_value: string | null;
    }[]
  >`
    select cl.id as client_id, cl.name as client_name,
           regexp_replace(cl.tax_id, '\D', '', 'g') as doc,
           ct.id as contract_id, ct.name as contract_name, ct.type as contract_type,
           coalesce(
             ct.category_id,
             (select c.id from categories c
               where c.entity_id = ct.entity_id
                 and c.code = case ct.type when 'retainer' then '3.01' else '3.02' end
               limit 1)
           ) as revenue_category_id,
           ct.monthly_value
    from clients cl
    left join contracts ct on ct.client_id = cl.id
    where cl.tax_id is not null and cl.tax_id <> ''`;

  const clientsByDocument = new Map<string, KnownClient>();
  for (const row of clientRows) {
    const existing = clientsByDocument.get(row.doc) ?? {
      id: row.client_id,
      name: row.client_name,
      contracts: [] as ClientContract[],
    };
    if (row.contract_id && row.revenue_category_id) {
      (existing.contracts as ClientContract[]).push({
        id: row.contract_id,
        name: row.contract_name ?? "",
        type: row.contract_type ?? "project",
        revenueCategoryId: row.revenue_category_id,
        monthlyValue: row.monthly_value === null ? null : fromNumeric(row.monthly_value),
      });
    }
    clientsByDocument.set(row.doc, existing);
  }

  const [semDoc] = await sql<{ n: string }[]>`
    select count(*) as n from clients where tax_id is null or tax_id = ''`;
  const semDocumento = Number(semDoc?.n ?? 0);

  const categoryCode = new Map(
    (await sql<{ id: string; code: string; name: string }[]>`
      select id, code, name from categories where kind = 'revenue'`).map((c) => [
      c.id,
      `${c.code} ${c.name}`,
    ]),
  );

  const judged = rows.map((row) => ({
    row,
    amount: fromNumeric(row.amount),
    verdict: judgeReceipt(
      {
        document: row.doc,
        counterpartyName: row.counterparty_name,
        amount: fromNumeric(row.amount),
      },
      clientsByDocument,
    ),
  }));

  const total = (list: typeof judged) => list.reduce((acc, item) => acc + item.amount, 0n);
  const of = (kind: ReceiptVerdict["kind"]) => judged.filter((item) => item.verdict.kind === kind);

  console.log(
    `\n${BOLD}${rows.length} entradas sem categoria${RESET}, somando ${formatBRL(total(judged))}\n`,
  );

  // ---- Clientes novos, agrupados por documento ----------------------------
  const novos = new Map<string, { name: string; lines: typeof judged }>();
  for (const item of of("cliente-novo")) {
    if (item.verdict.kind !== "cliente-novo") continue;
    const bucket = novos.get(item.verdict.document) ?? { name: item.verdict.name, lines: [] };
    bucket.lines.push(item);
    novos.set(item.verdict.document, bucket);
  }

  if (novos.size > 0) {
    console.log(
      `${BOLD}${novos.size} CNPJs sem cliente${RESET} ${DIM}— decisão sua: cadastrar novo, ou ligar a\n` +
        `  um dos ${semDocumento} clientes que já existem sem documento. Casar nome de empresa\n` +
        `  automaticamente duplica cliente, e isso estraga a margem por cliente em silêncio.${RESET}`,
    );
    for (const [doc, bucket] of [...novos].sort((a, b) => Number(total(b[1].lines) - total(a[1].lines)))) {
      console.log(
        `  ${GREEN}+${RESET} ${bucket.name.slice(0, 46).padEnd(48)} ${String(bucket.lines.length).padStart(2)}× ` +
          `${formatBRL(total(bucket.lines)).padStart(14)}  ${DIM}…${doc.slice(-6)}${RESET}`,
      );
    }
  }

  // ---- Clientes já conhecidos ---------------------------------------------
  const conhecidos = of("cliente-conhecido");
  const comConta = conhecidos.filter(
    (item) => item.verdict.kind === "cliente-conhecido" && item.verdict.categoryId !== null,
  );
  const semConta = conhecidos.filter(
    (item) => item.verdict.kind === "cliente-conhecido" && item.verdict.categoryId === null,
  );

  if (conhecidos.length > 0) {
    console.log(
      `\n${BOLD}${conhecidos.length} entradas de cliente já cadastrado${RESET}, ${formatBRL(total(conhecidos))}`,
    );
    for (const item of comConta) {
      if (item.verdict.kind !== "cliente-conhecido") continue;
      console.log(
        `  ${GREEN}✓${RESET} ${iso(item.row.occurred_on)} ${formatBRL(item.amount).padStart(13)}  ` +
          `${item.verdict.clientName.padEnd(14)} → ${categoryCode.get(item.verdict.categoryId ?? "") ?? "—"}` +
          `  ${DIM}${VERDICT_LABEL[item.verdict.basis]}${RESET}`,
      );
    }
    for (const item of semConta) {
      if (item.verdict.kind !== "cliente-conhecido") continue;
      console.log(
        `  ${YELLOW}?${RESET} ${iso(item.row.occurred_on)} ${formatBRL(item.amount).padStart(13)}  ` +
          `${item.verdict.clientName.padEnd(14)} → conta em aberto  ${DIM}${VERDICT_LABEL[item.verdict.basis]}${RESET}`,
      );
    }
  }

  // ---- O que não tem jeito por identidade ---------------------------------
  const pessoas = of("pessoa-fisica");
  const semId = of("sem-identidade");
  console.log(`\n${BOLD}Fora do alcance da identidade${RESET}`);
  console.log(
    `  ${pessoas.length} de pessoa física, ${formatBRL(total(pessoas))} ${DIM}— ${VERDICT_LABEL["pessoa-fisica"]}${RESET}`,
  );
  console.log(
    `  ${semId.length} sem documento, ${formatBRL(total(semId))} ${DIM}— ${VERDICT_LABEL["sem-documento"]}${RESET}`,
  );

  // ---- Escrita -------------------------------------------------------------
  // Só o que é identidade pura: o CNPJ já é de um cliente cadastrado. Nada de criar
  // cliente, e nada de escolher conta que dependa de julgamento.
  const write = async (db: postgres.TransactionSql) => {
    let ligados = 0;
    let comCategoria = 0;
    for (const item of judged) {
      if (item.verdict.kind !== "cliente-conhecido") continue;
      if (item.verdict.categoryId) {
        await db`update cash_entries set client_id = ${item.verdict.clientId},
                   category_id = ${item.verdict.categoryId} where id = ${item.row.id}`;
        comCategoria += 1;
      } else {
        await db`update cash_entries set client_id = ${item.verdict.clientId}
                 where id = ${item.row.id}`;
      }
      ligados += 1;
    }
    return { ligados, comCategoria };
  };

  if (conhecidos.length === 0) {
    console.log(`\n${DIM}nada a propor.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --ensaio para medir, ou --aplicar.${RESET}\n`,
    );
  } else {
    let resultado = { ligados: 0, comCategoria: 0 };
    if (REHEARSE) {
      const ROLLBACK = Symbol("ensaio");
      try {
        await sql.begin(async (db) => {
          resultado = await write(db);
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
    } else {
      resultado = await sql.begin(write);
    }

    console.log(
      `\n${BOLD}${REHEARSE ? "Ensaio (revertido)" : "Aplicado"}${RESET} — ` +
        `${resultado.ligados} entradas ligadas ao cliente pelo CNPJ, ` +
        `${resultado.comCategoria} com conta de receita. Nenhum cliente foi criado.`,
    );
    console.log(
      `${DIM}Nenhuma competência foi criada: receita nasce de contrato e NF (SPEC §5).\n` +
        `Rode ${RESET}npm run verify:reconcile${DIM} para confirmar que a ponte continua em zero.${RESET}\n`,
    );
  }

  // ---- O que sobra para você ----------------------------------------------
  const decisoes = [...semConta, ...[...novos.values()].flatMap((bucket) => bucket.lines)];
  if (decisoes.length > 0) {
    console.log(
      `${BOLD}Falta decidir a conta de receita de ${decisoes.length} entradas${RESET}, ${formatBRL(total(decisoes))}.`,
    );
    console.log(
      `${DIM}O cliente fica ligado de qualquer jeito — o que falta é dizer em qual receita cai.${RESET}\n`,
    );
  }
} finally {
  await sql.end();
}
