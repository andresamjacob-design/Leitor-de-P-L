/**
 * O rendimento que ficou dentro dos CDBs, lido da posição que o banco mostra (D148).
 *
 * As aplicações e resgates vêm do extrato da conta corrente (D84, D147); o que nenhum
 * extrato de conta corrente mostra é o rendimento que não foi varrido para ela. A tela
 * "Acompanhamento de investimentos" do Itaú dá, por conta, o **saldo bruto** numa data e o
 * rendimento de cada mês. A diferença entre o bruto e o saldo do app é rendimento.
 *
 * - O do mês da posição entra no último dia dele.
 * - O que sobra é rendimento de meses anteriores, e entra no último dia do mês anterior —
 *   não espalhado para trás. A planilha do Andre fez igual: o `Ending balance` de agosto dela
 *   (R$ 697.003,87) já trazia R$ 13.905,16 de rendimento acumulado que julho não trazia.
 *   Pôr parte em julho quebraria julho, que bate com ela ao centavo.
 * - Bruto, não líquido: o imposto só é retido no resgate, e aparece então.
 *
 * **Trava:** depois de gravar, o saldo de cada CDB na data da posição tem de ser exatamente o
 * bruto do print. Senão a transação volta inteira.
 *
 *   npm run rendimento:cdb              # mostra o que faria
 *   npm run rendimento:cdb -- --ensaio  # grava numa transação revertida
 *   npm run rendimento:cdb -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, parseMoney, toNumeric, type Cents } from "@/lib/money";
import { dedupHash } from "@/lib/dedup";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

/** Lido dos prints de 06/10 em `docs/reference/` (WhatsApp Image 2026-10-06 14.18 e 14.20). */
const POSICOES: { agencia: string; data: string; bruto: Cents; doMes: Cents }[] = [
  { agencia: "0561", data: "2026-09-30", bruto: parseMoney("539.630,20"), doMes: parseMoney("5.725,04") },
  { agencia: "2863", data: "2026-09-30", bruto: parseMoney("341.732,12"), doMes: parseMoney("1.732,12") },
];

const CODIGO = "11.04";
const NOME = "Rendimento de aplicação";

class Rollback extends Error {}

const ultimoDiaDoMesAnterior = (data: string): string => {
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  const fim = new Date(Date.UTC(ano, mes - 1, 0)); // dia 0 do mês = último do anterior
  return fim.toISOString().slice(0, 10);
};

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const saldoEm = async (db: postgres.Sql | postgres.TransactionSql, contaId: string, data: string) => {
    const [r] = await db<{ s: string }[]>`
      select (a.opening_balance + coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0))::text as s
        from accounts a left join cash_entries e on e.account_id = a.id and e.occurred_on <= ${data}
       where a.id = ${contaId} group by a.id`;
    return fromNumeric(r!.s);
  };

  type Plano = { contaId: string; nome: string; data: string; valor: Cents; descricao: string };
  const plano: Plano[] = [];
  const cdbs: { id: string; nome: string; data: string; bruto: Cents }[] = [];
  for (const p of POSICOES) {
    const contas = await sql<{ id: string; name: string }[]>`
      select id, name from accounts
       where entity_id = ${entity.id} and type = 'investment' and branch = ${p.agencia}`;
    if (contas.length !== 1) throw new Error(`esperava um CDB na agência ${p.agencia}, achei ${contas.length}`);
    const conta = contas[0]!;
    const app = await saldoEm(sql, conta.id, p.data);
    const diferenca = p.bruto - app;
    const anterior = diferenca - p.doMes;
    console.log(
      `\n${conta.name} — posição ${p.data}\n` +
        `  banco (bruto)        ${formatBRL(p.bruto).padStart(16)}\n` +
        `  app                  ${formatBRL(app).padStart(16)}\n` +
        `  rendimento do mês    ${formatBRL(p.doMes).padStart(16)}\n` +
        `  de meses anteriores  ${formatBRL(anterior).padStart(16)}`,
    );
    if (diferenca === 0n) continue;
    if (diferenca < 0n || anterior < 0n) {
      throw new Error(`${conta.name}: o app está acima do banco — rendimento negativo não se lança, investigar`);
    }
    cdbs.push({ id: conta.id, nome: conta.name, data: p.data, bruto: p.bruto });
    if (anterior > 0n) {
      const data = ultimoDiaDoMesAnterior(p.data);
      plano.push({ contaId: conta.id, nome: conta.name, data, valor: anterior,
        descricao: `RENDIMENTO CDB ACUMULADO ATE ${data.split("-").reverse().join("/")}` });
    }
    plano.push({ contaId: conta.id, nome: conta.name, data: p.data, valor: p.doMes,
      descricao: `RENDIMENTO CDB ${p.data.slice(5, 7)}/${p.data.slice(0, 4)}` });
  }

  console.log(`\nLançamentos (${CODIGO} ${NOME}):`);
  for (const l of plano) console.log(`  ${l.data}  ${formatBRL(l.valor).padStart(14)}  ${l.nome}  ${l.descricao}`);

  const write = async (db: postgres.TransactionSql) => {
    const [ref] = await db<{ sort_order: number }[]>`
      select sort_order from categories where entity_id = ${entity.id} and code = '11.03'`;
    const [cat] = await db<{ id: string }[]>`
      insert into categories (entity_id, code, name, kind, dre_group, sort_order)
      values (${entity.id}, ${CODIGO}, ${NOME}, 'revenue', 'financeiras', ${ref?.sort_order ?? 0})
      on conflict (entity_id, code) do update set name = excluded.name
      returning id`;
    for (const l of plano) {
      await db`insert into cash_entries ${db({
        entity_id: entity.id,
        account_id: l.contaId,
        occurred_on: l.data,
        amount: toNumeric(l.valor),
        direction: "in",
        description: l.descricao,
        category_id: cat!.id,
        dedup_hash: dedupHash({ accountId: l.contaId, occurredOn: l.data, amount: l.valor, direction: "in", description: l.descricao }),
      })}`;
    }
    // A trava: o saldo de cada CDB tem de ser o bruto do banco, ao centavo.
    for (const c of cdbs) {
      const depois = await saldoEm(db, c.id, c.data);
      if (depois !== c.bruto) {
        throw new Error(`${c.nome}: depois de gravar o app daria ${formatBRL(depois)}, o banco diz ${formatBRL(c.bruto)}`);
      }
      console.log(`  trava ok — ${c.nome} em ${c.data}: ${formatBRL(depois)} = banco`);
    }
  };

  if (plano.length === 0) console.log("\nos CDBs já batem com o banco — nada a fazer.\n");
  else if (!APPLY && !REHEARSE) console.log("\nnada foi gravado. --ensaio para ensaiar, --aplicar para gravar.\n");
  else if (REHEARSE) {
    await sql
      .begin(async (tx) => {
        await write(tx);
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
    console.log("\nensaio: a transação foi revertida, nada foi gravado.\n");
  } else {
    await sql.begin(write);
    console.log("\ngravado. Rode npm run verify:reconcile.\n");
  }
} finally {
  await sql.end();
}
