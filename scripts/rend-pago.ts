/**
 * O rendimento pago na conta corrente é entrada (D150).
 *
 * `REND PAGO APLIC AUT` é o rendimento da aplicação automática, que o banco credita **na conta
 * corrente**. A regra o mandava para `99.03` (transferência), embora o leitor do extrato já
 * dissesse em comentário que ele *"is real income"*. O Andre conta essa linha no Income: a
 * diferença de entrada entre a planilha dele e o app era, mês a mês, exatamente a soma dela
 * (fevereiro R$ 65,51, julho R$ 38,59, setembro R$ 13,63…). E o setembro dele é R$ 960.151,56.
 *
 * O outro rendimento, o que **fica dentro do CDB** (`11.04`, D148), continua fora do Income e
 * entra no saldo final (D149) — é a outra metade da convenção dele.
 *
 * Troca a regra e a conta das linhas que já estão no razão. Não muda valor nem data:
 * trava — o saldo de toda conta tem de ser o mesmo antes e depois.
 *
 *   npm run rend:pago              # o que mudaria
 *   npm run rend:pago -- --ensaio
 *   npm run rend:pago -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const CODIGO = "11.05";
const NOME = "Rendimento da aplicação automática";

class Rollback extends Error {}
const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const entityId = entity!.id;

  const linhas = await sql<{ mes: string; n: number; total: string }[]>`
    select to_char(ce.occurred_on, 'YYYY-MM') as mes, count(*)::int as n, sum(ce.amount)::text as total
      from cash_entries ce join categories c on c.id = ce.category_id
     where ce.entity_id = ${entityId} and c.code = '99.03' and ce.direction = 'in'
       and ce.description ilike '%REND%PAGO%'
     group by 1 order by 1`;
  console.log(`\nREND PAGO em 99.03, que vão para ${CODIGO} ${NOME}:`);
  for (const l of linhas) console.log(`  ${l.mes}  ${String(l.n).padStart(2)} linha(s)  ${formatBRL(fromNumeric(l.total)).padStart(12)}`);

  const saldos = async (db: postgres.Sql | postgres.TransactionSql) =>
    (await db<{ id: string; s: string }[]>`
      select a.id, (a.opening_balance + coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0))::text as s
        from accounts a left join cash_entries e on e.account_id = a.id
       where a.entity_id = ${entityId} group by a.id order by a.id`).map((r) => `${r.id}:${r.s}`).join("|");
  const antes = await saldos(sql);

  const write = async (db: postgres.TransactionSql) => {
    const [ref] = await db<{ sort_order: number }[]>`
      select sort_order from categories where entity_id = ${entityId} and code = '11.03'`;
    const [cat] = await db<{ id: string }[]>`
      insert into categories (entity_id, code, name, kind, dre_group, sort_order)
      values (${entityId}, ${CODIGO}, ${NOME}, 'revenue', 'financeiras', ${ref?.sort_order ?? 0})
      on conflict (entity_id, code) do update set name = excluded.name
      returning id`;
    const regras = await db`
      update categorization_rules set category_id = ${cat!.id}
       where entity_id = ${entityId} and pattern = 'REND PAGO' and direction = 'in'`;
    const movidas = await db`
      update cash_entries ce set category_id = ${cat!.id}, updated_at = now()
        from categories c
       where c.id = ce.category_id and ce.entity_id = ${entityId} and c.code = '99.03'
         and ce.direction = 'in' and ce.description ilike '%REND%PAGO%'`;
    if (await saldos(db) !== antes) throw new Error("algum saldo de conta mudaria — nada gravado");
    console.log(`\n  ${regras.count} regra trocada, ${movidas.count} linha(s) movidas; trava ok — nenhum saldo mudou`);
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
