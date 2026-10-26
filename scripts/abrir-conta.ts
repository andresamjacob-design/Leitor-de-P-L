/**
 * Dá a uma conta o saldo de abertura e a data dele (D147).
 *
 * Nasceu da GSJacob (0099290-1): o extrato começa em 08/09 sem saldo anterior, e o app ficava
 * R$ 19.000 abaixo do banco em todos os dias — e **negativo** em 09/09, que o banco nunca
 * esteve. O Andre respondeu em 06/10: *"Saldo de abertura = R$19000"*.
 *
 * **A data importa tanto quanto o valor** (lição do handover): a conta estava cadastrada
 * com abertura em 01/01. R$ 19.000 em 01/01 somariam R$ 19 mil a todo mês de janeiro a
 * agosto, que hoje batem com a planilha. A abertura vai para o dia anterior ao primeiro
 * lançamento, e o fluxo a mostra naquele mês, em Transferências.
 *
 * Recusa se houver lançamento da conta antes da data — abertura depois de movimento seria
 * contar o mesmo dinheiro duas vezes.
 *
 *   npm run abrir:conta -- --conta 0099290-1 --saldo 19000,00 --data 2026-09-07
 *   ... --ensaio   # grava numa transação revertida e mostra o antes e o depois
 *   ... --aplicar
 */

import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, parseMoney, toNumeric } from "@/lib/money";

loadEnvLocal();

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? undefined : process.argv[i + 1];
};
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const numero = arg("--conta");
const saldoTexto = arg("--saldo");
const data = arg("--data");
if (!numero || !saldoTexto || !data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
  throw new Error("uso: --conta <número> --saldo <valor> --data AAAA-MM-DD");
}
const saldo = parseMoney(saldoTexto);

class Rollback extends Error {}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const contas = await sql<{ id: string; name: string; ob: string; od: string }[]>`
    select a.id, a.name, a.opening_balance::text as ob, a.opening_date::text as od
      from accounts a join entities e on e.id = a.entity_id
     where e.slug = 'dd-group' and a.number = ${numero}`;
  if (contas.length !== 1) throw new Error(`esperava uma conta ${numero}, achei ${contas.length}`);
  const conta = contas[0]!;

  const [antes] = await sql<{ n: number; primeiro: string | null }[]>`
    select count(*)::int as n, min(occurred_on)::text as primeiro
      from cash_entries where account_id = ${conta.id} and occurred_on <= ${data}`;
  if ((antes?.n ?? 0) > 0) {
    throw new Error(`${antes!.n} lançamento(s) da conta em ou antes de ${data} — abertura recusada`);
  }

  console.log(`\n${conta.name}`);
  console.log(`  hoje   ${formatBRL(fromNumeric(conta.ob))} em ${conta.od}`);
  console.log(`  depois ${formatBRL(saldo)} em ${data}`);

  const write = async (db: Sql) => {
    await db`update accounts set opening_balance = ${toNumeric(saldo)}, opening_date = ${data}
              where id = ${conta.id}`;
    const [r] = await db<{ ob: string; od: string }[]>`
      select opening_balance::text as ob, opening_date::text as od from accounts where id = ${conta.id}`;
    return r!;
  };

  if (!APPLY && !REHEARSE) {
    console.log(`\nnada foi gravado. --ensaio para ensaiar, --aplicar para gravar.\n`);
  } else if (REHEARSE) {
    await sql
      .begin(async (tx) => {
        const r = await write(tx as unknown as Sql);
        console.log(`\nensaio: ficaria ${formatBRL(fromNumeric(r.ob))} em ${r.od}; revertido.\n`);
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
  } else {
    const r = await write(sql);
    console.log(`\ngravado: ${formatBRL(fromNumeric(r.ob))} em ${r.od}.`);
    console.log(`confira com npm run conferir:banco e npm run verify:reconcile.\n`);
  }
} finally {
  await sql.end();
}
