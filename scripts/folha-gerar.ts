/**
 * Gera a folha em competência a partir do cadastro (D161), pela mesma função que a tela usa
 * (`regerar_folha`, migration 0010).
 *
 * Mostra, mês a mês, a folha que havia, a nova, e o espelho de caixa que sai. Trava: nenhum
 * saldo de conta pode mudar — folha é competência, não caixa.
 *
 *   npm run folha:gerar -- --de 2026-01 --ate 2026-10              # mostra
 *   npm run folha:gerar -- --de 2026-01 --ate 2026-10 --ensaio
 *   npm run folha:gerar -- --de 2026-01 --ate 2026-10 --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";

loadEnvLocal();

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? undefined : process.argv[i + 1];
};
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const de = arg("--de");
const ate = arg("--ate");
if (!de || !ate || !/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate) || de > ate) {
  throw new Error("uso: --de AAAA-MM --ate AAAA-MM [--ensaio|--aplicar]");
}
const meses: string[] = [];
for (let [a, m] = de.split("-").map(Number) as [number, number]; `${a}-${String(m).padStart(2, "0")}` <= ate; m === 12 ? ((a += 1), (m = 1)) : (m += 1)) {
  meses.push(`${a}-${String(m).padStart(2, "0")}-01`);
}

class Rollback extends Error {}
const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const id = entity!.id;
  const folha = async (db: postgres.Sql | postgres.TransactionSql, mes: string) => {
    const [r] = await db<{ t: string }[]>`
      select coalesce(sum(r.amount), 0)::text as t from recognition_entries r join categories c on c.id = r.category_id
       where r.entity_id = ${id} and r.source = 'accrual' and r.period = ${mes} and c.code in ('6.10', '6.11')`;
    return fromNumeric(r!.t);
  };
  const espelhos = async (db: postgres.Sql | postgres.TransactionSql, mes: string) => {
    const [r] = await db<{ t: string }[]>`
      select coalesce(sum(r.amount), 0)::text as t
        from recognition_entries r join categories c on c.id = r.category_id join cash_entries e on e.id = r.cash_entry_id
       where r.entity_id = ${id} and r.source = 'cash_mirror' and c.code in ('6.10', '6.11')
         and e.occurred_on >= ${mes}::date and e.occurred_on < (${mes}::date + interval '1 month')`;
    return fromNumeric(r!.t);
  };
  const saldos = async (db: postgres.Sql | postgres.TransactionSql) =>
    (await db<{ s: string }[]>`
      select string_agg(a.id::text || ':' || (a.opening_balance + coalesce((select sum(case when e.direction = 'in' then e.amount else -e.amount end)
             from cash_entries e where e.account_id = a.id), 0))::text, '|' order by a.id) as s
        from accounts a where a.entity_id = ${id}`)[0]!.s;

  const antes = await Promise.all(meses.map(async (m) => ({ m, folha: await folha(sql, m), espelho: await espelhos(sql, m) })));
  const saldoAntes = await saldos(sql);

  const write = async (db: postgres.TransactionSql) => {
    console.log(`\nmês       folha antes        folha nova        espelho que sai`);
    for (const a of antes) {
      const [r] = await db<{ t: string }[]>`select regerar_folha(${id}, ${a.m}::date)::text as t`;
      const nova = fromNumeric(r!.t);
      console.log(
        `${a.m.slice(0, 7)}  ${formatBRL(a.folha).padStart(16)}  ${formatBRL(nova).padStart(16)}  ${formatBRL(a.espelho).padStart(16)}` +
          `${a.folha === nova ? "  igual" : ""}`,
      );
    }
    if ((await saldos(db)) !== saldoAntes) throw new Error("algum saldo de conta mudaria — nada gravado");
    console.log("trava ok — nenhum saldo de conta mudou");
  };

  if (!APPLY && !REHEARSE) {
    console.log(`\n${meses.length} mês(es). Nada foi gravado. --ensaio para ensaiar, --aplicar para gravar.\n`);
  } else if (REHEARSE) {
    await sql.begin(async (tx) => { await write(tx); throw new Rollback(); })
      .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    console.log("ensaio: revertido, nada foi gravado.\n");
  } else {
    await sql.begin(write);
    console.log("gravado. Rode npm run verify:reconcile.\n");
  }
} finally {
  await sql.end();
}
