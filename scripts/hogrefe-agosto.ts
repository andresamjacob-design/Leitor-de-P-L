/**
 * Os R$ 19.000 da GSJacob em 07/09 eram a Hogrefe de agosto (D151).
 *
 * O Andre em 07/10: *"os 19000 da hogrefe foram income de agosto que são a primeira coisa que
 * entra na conta gsjacob"*. A D147 os tinha lançado como saldo de abertura em 07/09, porque o
 * extrato da conta começa em 08/09. O saldo fechava com o banco, mas o dinheiro aparecia em
 * setembro e como abertura, enquanto na planilha dele é receita de agosto.
 *
 * → A conta passa a abrir **zerada**, e entram os dois recebimentos da Hogrefe:
 *
 *   - R$ 9.000 de retainer (`3.01`) e R$ 10.000 de parcela de projeto (`3.02`) — a divisão de
 *     todo mês desde julho, e a da DRE dele em agosto.
 *   - **Em 16/08, data inferida**: a Hogrefe paga sempre no dia 16 (16/06, 16/07). Sem o
 *     extrato de agosto da GSJacob, o dia não é medido, e a descrição diz isso. Para o fluxo
 *     mensal o dia não muda nada.
 *   - Com o CNPJ da Hogrefe, para o extrato de agosto, se vier, reconhecer as duas linhas pelo
 *     documento (D142) em vez de duplicá-las.
 *
 * Trava: o saldo da GSJacob em 07/09 — e portanto em todo dia conferido com o banco depois —
 * tem de ser o mesmo antes e depois.
 *
 *   npm run hogrefe:agosto              # o que faria
 *   npm run hogrefe:agosto -- --ensaio
 *   npm run hogrefe:agosto -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, parseMoney, toNumeric } from "@/lib/money";
import { dedupHash } from "@/lib/dedup";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const CONTA = "0099290-1";
const DATA = "2026-08-16";
const ABERTURA = "2026-08-15";
const DESCRICAO = "RECEBIMENTOS HOGREFE (agosto, sem extrato: data inferida)";
const PARTES = [
  { valor: parseMoney("9.000,00"), code: "3.01" },
  { valor: parseMoney("10.000,00"), code: "3.02" },
];

class Rollback extends Error {}
const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const entityId = entity!.id;
  const [conta] = await sql<{ id: string; ob: string; od: string }[]>`
    select id, opening_balance::text as ob, opening_date::text as od
      from accounts where entity_id = ${entityId} and number = ${CONTA}`;
  if (!conta) throw new Error(`conta ${CONTA} não encontrada`);
  const [cliente] = await sql<{ id: string; tax_id: string }[]>`
    select id, tax_id from clients where entity_id = ${entityId} and name = 'Hogrefe'`;
  if (!cliente) throw new Error("cliente Hogrefe não encontrado");
  const cats = new Map(
    (await sql<{ id: string; code: string }[]>`
      select id, code from categories where entity_id = ${entityId} and code in ('3.01', '3.02')`).map((c) => [c.code, c.id]),
  );

  const total = PARTES.reduce((a, p) => a + p.valor, 0n);
  if (fromNumeric(conta.ob) !== total) {
    throw new Error(`a abertura da conta é ${formatBRL(fromNumeric(conta.ob))}, não ${formatBRL(total)} — já foi trocada?`);
  }

  const saldoEm = async (db: postgres.Sql | postgres.TransactionSql, data: string) => {
    const [r] = await db<{ s: string }[]>`
      select (a.opening_balance + coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0))::text as s
        from accounts a left join cash_entries e on e.account_id = a.id and e.occurred_on <= ${data}
       where a.id = ${conta.id} group by a.id`;
    return fromNumeric(r!.s);
  };
  const antes = await saldoEm(sql, "2026-09-07");

  console.log(`\nItau GSJACOB: abertura ${formatBRL(total)} em ${conta.od} → R$ 0,00 em ${ABERTURA}`);
  for (const p of PARTES) console.log(`  + ${DATA}  ${formatBRL(p.valor).padStart(12)}  ${p.code}  Hogrefe`);

  const write = async (db: postgres.TransactionSql) => {
    await db`update accounts set opening_balance = 0, opening_date = ${ABERTURA} where id = ${conta.id}`;
    for (const p of PARTES) {
      await db`insert into cash_entries ${db({
        entity_id: entityId,
        account_id: conta.id,
        occurred_on: DATA,
        amount: toNumeric(p.valor),
        direction: "in",
        description: DESCRICAO,
        category_id: cats.get(p.code)!,
        client_id: cliente.id,
        counterparty_name: "HOGREFE",
        counterparty_tax_id: cliente.tax_id,
        dedup_hash: dedupHash({ accountId: conta.id, occurredOn: DATA, amount: p.valor, direction: "in", description: DESCRICAO, counterparty: p.code }),
      })}`;
    }
    const depois = await saldoEm(db, "2026-09-07");
    if (depois !== antes) throw new Error(`o saldo em 07/09 mudaria de ${formatBRL(antes)} para ${formatBRL(depois)}`);
    console.log(`  trava ok — saldo da GSJacob em 07/09: ${formatBRL(depois)}, antes e depois`);
  };

  if (!APPLY && !REHEARSE) console.log(`\nnada foi gravado. --ensaio para ensaiar, --aplicar para gravar.\n`);
  else if (REHEARSE) {
    await sql.begin(async (tx) => { await write(tx); throw new Rollback(); })
      .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    console.log(`ensaio: revertido, nada foi gravado.\n`);
  } else {
    await sql.begin(write);
    console.log(`gravado.\n`);
  }
} finally {
  await sql.end();
}
