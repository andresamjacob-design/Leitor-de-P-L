/**
 * Funde dois cadastros do mesmo cliente num só (D133).
 *
 * ## O que está sendo consertado
 *
 * Cinco clientes existem **duas vezes**, e cada cópia tem metade da história:
 *
 * ```
 * "Santa Lucia"  CNPJ: —                  "Santa Lucia"  CNPJ: 06278750000106
 *   receita R$ 20.000 × 3                   receita: nenhuma
 *   contratos: 1                            contratos: 0
 *   caixa: nenhum                           caixa: R$ 35.000 em 27/07
 * ```
 *
 * Não é digitação duplicada — são **duas portas de entrada que não se reconheceram**. Uma
 * cópia nasceu da planilha de DRE, que traz contrato e receita e não tem CNPJ de ninguém; a
 * outra nasceu do extrato, que traz o CNPJ de quem pagou e não sabe o que foi contratado.
 *
 * **Isso já fez um número mentir.** Ao medir quem pagou o quê em agosto, o casamento foi por
 * CNPJ — e o CNPJ mora no gêmeo que não tem receita. O resultado foi "R$ 443 mil de receita
 * de agosto sem caixa", que era falso: os clientes tinham pago, e o pagamento não achava o
 * cadastro certo.
 *
 * ## Quem sobrevive, e por quê
 *
 * **Fica o cadastro com histórico** — contrato, receita, lançamentos — e ele **recebe o
 * CNPJ** do outro. O contrário seria pior: mover contrato e competência é mexer no que já
 * foi decidido, enquanto copiar um documento é acrescentar o que faltava.
 *
 * Sete tabelas apontam para cliente (`people`, `contracts`, `invoices`,
 * `staged_transactions`, `cash_entries`, `recognition_entries`, `categorization_rules`) e
 * todas são repontadas antes de o perdedor ser apagado. Se alguma sobrar apontando para ele,
 * o `delete` falha na chave estrangeira — e falhar é o comportamento certo.
 *
 * ## A trava
 *
 * Só funde par que o Andre confirmou por nome, listado abaixo. E **recusa** se o perdedor
 * tiver CNPJ **diferente** do que se espera, ou se o sobrevivente já tiver um documento
 * diferente: dois CNPJs distintos sob o mesmo nome são duas empresas até prova em contrário,
 * e essa prova não é minha para dar.
 *
 *   npm run fundir              # dry run
 *   npm run fundir -- --ensaio  # grava numa transação revertida e mede
 *   npm run fundir -- --aplicar
 */

import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

class Rollback extends Error {}

/** Confirmado pelo Andre em 14/09/2026: os dois cadastros são a mesma empresa. */
const PARES: readonly { nome: string; doc: string }[] = [
  { nome: "Danke", doc: "05634508000165" },
  { nome: "Enutri", doc: "26053244000126" },
  { nome: "Medcom", doc: "22635177000105" },
  { nome: "RiHappy", doc: "58731662000111" },
  { nome: "Santa Lucia", doc: "06278750000106" },
];

/** As sete tabelas que apontam para cliente. */
const REFERENCIAS = [
  { tabela: "people", coluna: "client_id" },
  { tabela: "contracts", coluna: "client_id" },
  { tabela: "invoices", coluna: "client_id" },
  { tabela: "staged_transactions", coluna: "suggested_client_id" },
  { tabela: "cash_entries", coluna: "client_id" },
  { tabela: "recognition_entries", coluna: "client_id" },
  { tabela: "categorization_rules", coluna: "client_id" },
] as const;

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");
  const entityId = entity.id;

  console.log(`\n${BOLD}Cadastros em duplicata${RESET}\n`);

  type Plano = { nome: string; fica: string; sai: string; doc: string; mexe: number };
  const planos: Plano[] = [];

  for (const par of PARES) {
    const cadastros = await sql<{ id: string; name: string; tax_id: string | null }[]>`
      select id, name, tax_id from clients
       where entity_id = ${entityId} and name = ${par.nome}`;

    if (cadastros.length !== 2) {
      console.log(
        `  ${par.nome.padEnd(14)} ${YELLOW}${cadastros.length} cadastro(s), não 2 — pulado${RESET}`,
      );
      continue;
    }

    const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
    const comDoc = cadastros.filter((c) => digits(c.tax_id) !== "");
    const semDoc = cadastros.filter((c) => digits(c.tax_id) === "");

    // Recusa qualquer coisa que não seja exatamente "um com documento, um sem" — e o
    // documento tem de ser o que o Andre confirmou.
    if (comDoc.length !== 1 || semDoc.length !== 1) {
      console.log(
        `  ${par.nome.padEnd(14)} ${RED}os dois têm documento, ou nenhum tem — não é este caso${RESET}`,
      );
      continue;
    }
    if (digits(comDoc[0]!.tax_id) !== par.doc) {
      console.log(
        `  ${par.nome.padEnd(14)} ${RED}documento no banco é ${digits(comDoc[0]!.tax_id)}, ` +
          `esperado ${par.doc} — não confere${RESET}`,
      );
      continue;
    }

    // Quem fica é quem tem histórico: contrato e competência são decisão tomada, e mover
    // decisão é mais arriscado que copiar um documento.
    const [peso] = await sql<{ n: number }[]>`
      select (select count(*) from recognition_entries where client_id = ${semDoc[0]!.id})
           + (select count(*) from contracts where client_id = ${semDoc[0]!.id}) as n`;
    const fica = (peso?.n ?? 0) > 0 ? semDoc[0]! : comDoc[0]!;
    const sai = fica.id === semDoc[0]!.id ? comDoc[0]! : semDoc[0]!;

    let mexe = 0;
    for (const ref of REFERENCIAS) {
      const [c] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${ref.tabela} where ${ref.coluna} = $1`,
        [sai.id],
      );
      mexe += c?.n ?? 0;
    }

    const [rec] = await sql<{ total: string }[]>`
      select coalesce(sum(amount), 0)::text as total from recognition_entries
       where client_id = ${fica.id} and kind = 'revenue'`;

    console.log(
      `  ${BOLD}${par.nome}${RESET}  ${DIM}fica o cadastro com ` +
        `${formatBRL(fromNumeric(rec?.total ?? "0"))} de receita, e ganha o CNPJ ` +
        `…${par.doc.slice(-6)}${RESET}`,
    );
    console.log(
      `     ${GREEN}${mexe} referência(s)${RESET} do outro cadastro passam para ele, ` +
        `${DIM}e o cadastro vazio é apagado${RESET}`,
    );

    planos.push({ nome: par.nome, fica: fica.id, sai: sai.id, doc: par.doc, mexe });
  }

  console.log(`\n${BOLD}${planos.length} par(es) a fundir${RESET}.`);

  async function write(db: Sql): Promise<{ pares: number; movidas: number }> {
    let movidas = 0;
    for (const p of planos) {
      for (const ref of REFERENCIAS) {
        const moved = await db.unsafe(
          `update ${ref.tabela} set ${ref.coluna} = $1 where ${ref.coluna} = $2`,
          [p.fica, p.sai],
        );
        movidas += moved.count ?? 0;
      }
      await db`update clients set tax_id = ${p.doc} where id = ${p.fica}`;
      // Se alguma referência tiver escapado, esta linha falha na chave estrangeira — e
      // falhar é melhor que apagar um cadastro que ainda é apontado por alguém.
      await db`delete from clients where id = ${p.sai}`;
    }
    return { pares: planos.length, movidas };
  }

  if (planos.length === 0) {
    console.log(`\n${DIM}nada a fazer.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --ensaio para ensaiar numa transação revertida, ` +
        `ou --aplicar para fundir.${RESET}\n`,
    );
  } else {
    const done = await (REHEARSE
      ? sql
          .begin(async (tx) => {
            const counts = await write(tx as unknown as Sql);
            throw new Rollback(JSON.stringify(counts));
          })
          .catch((error: unknown) => {
            if (error instanceof Rollback) {
              return JSON.parse(error.message) as { pares: number; movidas: number };
            }
            throw error;
          })
      : write(sql));

    console.log(
      `\n${GREEN}${done.pares} par(es) ${REHEARSE ? "seriam fundidos" : "fundidos"}${RESET}, ` +
        `${done.movidas} referência(s) repontada(s).`,
    );
    if (REHEARSE) console.log(`${DIM}ensaio: a transação foi revertida, nada foi gravado.${RESET}\n`);
    else console.log("");
  }
} finally {
  await sql.end();
}
