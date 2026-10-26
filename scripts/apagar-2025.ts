/**
 * Tira de 2025 o que não sustenta nenhum número de 2026 (D137).
 *
 * O Andre em 16/09/2026: *"o ano de 2025 não é para ter relação com o app, a não ser que
 * seja um dado fundamental para marcar 2026, apague."*
 *
 * A exceção dele existe de verdade, e é o que este script separa.
 *
 * ## O teste, e por que não é a data
 *
 * Compra de cartão entra no fluxo **no mês em que a fatura foi paga** (D116). Uma compra de
 * novembro de 2025 numa fatura paga em janeiro de 2026 é despesa de 2026 com data de compra
 * antiga — apagá-la deixaria o pagamento daquela fatura sem conteúdo.
 *
 * Então o critério não é `occurred_on < 2026`. É: **a fatura casa com um pagamento que
 * existe no razão?** O casamento é o mesmo do `quebrarFaturas` — valor líquido exato, um
 * para um — e todo pagamento no razão é de 2026, porque o extrato bancário começa em
 * 01/01/2026.
 *
 * Também não é o nome do arquivo. `Itaucard_4460_fatura_072026.pdf` é a fatura de
 * vencimento 05/04, e `Fatura Cartao Final 5780 01-2026` é paga em 05/01 — nome de fatura
 * não significa nada, e essa armadilha já custou tempo antes.
 *
 * ## O que sai, medido
 *
 * Quatro faturas — os ciclos de setembro a dezembro de 2025 — **não casam com pagamento
 * nenhum**. São 85 compras, R$ 45.489,81 de dívida de cartão que o razão nunca viu ser paga,
 * porque o extrato daquele período nunca entrou. Nada em 2026 depende delas.
 *
 * As outras 51 compras de 2025, R$ 18.020,17, ficam: estão em faturas pagas em 05/01, 05/02,
 * 05/03, 06/04 e 05/05 de 2026, e são exatamente o conteúdo daqueles pagamentos.
 *
 * ## O que é apagado junto
 *
 * O espelho de competência de cada compra, a linha de staging que a originou e o registro da
 * importação. Apagar só o lançamento deixaria staging dizendo "aprovado" apontando para
 * nada, e um import que afirma ter lido um arquivo cujo conteúdo sumiu — duas mentiras
 * pequenas que confundem quem ler depois.
 *
 * Remover o `statement_imports` também **devolve a possibilidade de reimportar**, se um dia
 * 2025 voltar a importar. O `file_hash` é o que recusa arquivo repetido, e ele vai junto.
 *
 *   npm run apagar:2025              # mostra o que faria
 *   npm run apagar:2025 -- --ensaio  # apaga numa transação revertida e mede
 *   npm run apagar:2025 -- --aplicar
 */

import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, type Cents } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

class Rollback extends Error {}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");
  const entityId = entity.id;

  // ---- Quais faturas casam com um pagamento -------------------------------
  const compras = await sql<
    { importId: string; amount: string; direction: string; occurred: string }[]
  >`
    select ce.import_id as "importId", ce.amount::text as amount, ce.direction,
           ce.occurred_on::text as occurred
      from cash_entries ce
      join accounts a on a.id = ce.account_id and a.type = 'credit_card'
     where ce.entity_id = ${entityId} and ce.import_id is not null`;

  const pagamentos = await sql<{ amount: string; occurred: string }[]>`
    select ce.amount::text as amount, ce.occurred_on::text as occurred
      from cash_entries ce
      join categories c on c.id = ce.category_id
      join accounts a on a.id = ce.account_id and a.type in ('bank', 'cash', 'investment')
     where ce.entity_id = ${entityId} and c.code = '99.02' and ce.direction = 'out'
     order by ce.occurred_on`;

  type Resumo = { liquido: Cents; total: number; de2025: number; valor2025: Cents };
  const faturas = new Map<string, Resumo>();
  for (const c of compras) {
    const r = faturas.get(c.importId) ?? { liquido: 0n, total: 0, de2025: 0, valor2025: 0n };
    const v = fromNumeric(c.amount);
    r.liquido += c.direction === "out" ? v : -v;
    r.total += 1;
    if (c.occurred < "2026-01-01") {
      r.de2025 += 1;
      r.valor2025 += v;
    }
    faturas.set(c.importId, r);
  }

  // O mesmo casamento do `quebrarFaturas`: valor exato, um para um, e nenhuma casa duas vezes.
  const porValor = new Map<string, string[]>();
  for (const [imp, r] of faturas) {
    const k = r.liquido.toString();
    porValor.set(k, [...(porValor.get(k) ?? []), imp]);
  }
  const pagaEm = new Map<string, string>();
  for (const p of pagamentos) {
    const imp = porValor.get(fromNumeric(p.amount).toString())?.shift();
    if (imp) pagaEm.set(imp, p.occurred);
  }

  // Só sai fatura que é **inteiramente** de 2025 e não casa com pagamento nenhum. Uma
  // fatura com compra de 2026 dentro nunca entra aqui, mesmo sem pagamento: apagá-la levaria
  // 2026 junto, que é exatamente o que a exceção do Andre proíbe.
  const aRemover = [...faturas].filter(
    ([imp, r]) => !pagaEm.has(imp) && r.de2025 === r.total && r.total > 0,
  );

  console.log(`\n${BOLD}Faturas com compra de 2025${RESET}\n`);
  for (const [imp, r] of [...faturas].filter(([, r]) => r.de2025 > 0)) {
    const [f] = await sql<{ filename: string }[]>`
      select filename from statement_imports where id = ${imp}`;
    const pago = pagaEm.get(imp);
    const sai = aRemover.some(([i]) => i === imp);
    console.log(
      `  ${(f?.filename ?? imp).slice(0, 40).padEnd(40)} ` +
        `${String(r.de2025).padStart(3)}/${String(r.total).padEnd(3)} de 2025 ` +
        `${formatBRL(r.valor2025).padStart(13)}  ` +
        (pago
          ? `${GREEN}paga em ${pago} — fica${RESET}`
          : sai
            ? `${YELLOW}sem pagamento no razão — sai${RESET}`
            : `${GREEN}tem compra de 2026 dentro — fica${RESET}`),
    );
  }

  const ids = aRemover.map(([imp]) => imp);
  if (ids.length === 0) {
    console.log(`\n${DIM}nada a apagar.${RESET}\n`);
  } else {
    const [conta] = await sql<{ ce: number; rec: number; st: number; valor: string }[]>`
      select (select count(*)::int from cash_entries where import_id = any(${ids})) as ce,
             (select count(*)::int from recognition_entries
               where cash_entry_id in (select id from cash_entries where import_id = any(${ids}))) as rec,
             (select count(*)::int from staged_transactions where import_id = any(${ids})) as st,
             (select coalesce(sum(amount), 0)::text from cash_entries where import_id = any(${ids})) as valor`;

    console.log(
      `\n${BOLD}${ids.length} fatura(s) saem${RESET}: ${conta!.ce} lançamentos ` +
        `(${formatBRL(fromNumeric(conta!.valor))}), ${conta!.rec} espelhos de competência, ` +
        `${conta!.st} linhas de staging.`,
    );

    async function write(db: Sql): Promise<{ rec: number; ce: number; st: number; imp: number }> {
      // Na ordem das dependências: o espelho aponta para o lançamento, o lançamento aponta
      // para a importação. Invertida, o banco recusa — e recusar seria o certo.
      const rec = await db`
        delete from recognition_entries
         where cash_entry_id in (select id from cash_entries where import_id = any(${ids}))`;
      const ce = await db`delete from cash_entries where import_id = any(${ids})`;
      const st = await db`delete from staged_transactions where import_id = any(${ids})`;
      const imp = await db`delete from statement_imports where id = any(${ids})`;
      return { rec: rec.count, ce: ce.count, st: st.count, imp: imp.count };
    }

    if (!APPLY && !REHEARSE) {
      console.log(
        `\n${DIM}nada foi apagado. Rode com --ensaio para ensaiar numa transação revertida, ` +
          `ou --aplicar.${RESET}\n`,
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
                return JSON.parse(error.message) as {
                  rec: number; ce: number; st: number; imp: number;
                };
              }
              throw error;
            })
        : write(sql));

      console.log(
        `\n${GREEN}${done.ce} lançamentos, ${done.rec} espelhos, ${done.st} staged e ` +
          `${done.imp} importação(ões) ${REHEARSE ? "seriam apagados" : "apagados"}${RESET}.`,
      );
      if (REHEARSE) console.log(`${DIM}ensaio: a transação foi revertida, nada mudou.${RESET}\n`);
      else console.log(`${DIM}Rode npm run verify:reconcile para confirmar a ponte.${RESET}\n`);
    }
  }
} finally {
  await sql.end();
}
