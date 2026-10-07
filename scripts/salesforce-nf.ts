/**
 * Divide um recebimento da Salesforce entre os clientes da invoice dela (D148).
 *
 * O Andre em 06/10: *"recebo PDF que fala a divisão de cada um dos clientes que pagaram,
 * adicionar meio de ler isso"*. O extrato mostra um total em reais; a invoice diz quantos
 * dólares são de cada cliente. A divisão é proporcional ao dólar, em centavos, e soma
 * exatamente o recebido.
 *
 * **Qual recebimento é de qual invoice não é adivinhado.** O script mostra os candidatos —
 * recebimentos em `3.03` perto do vencimento, com o câmbio que cada um implicaria — e só
 * divide o que for apontado com `--lancamento AAAA-MM-DD`. A invoice 125 é o exemplo de por
 * que: ela parecia ser um `FIN COMPRA` e o câmbio redondo (R$ 5,0000) aponta para um
 * `OP REC EXT`.
 *
 * Partir segue a D109: a linha original fica com a primeira parte e **mantém o `dedup_hash`**,
 * para reimportar o extrato não trazer o total de volta; as outras ganham hash próprio com o
 * nome do cliente (duas partes de mesmo valor não podem colidir). Trava: o saldo da conta
 * não se move.
 *
 *   npm run salesforce:nf -- --arquivo "docs/reference/Invoice - SF - 125.pdf"
 *   ... --lancamento 2026-09-18 --ensaio
 *   ... --lancamento 2026-09-18 --aplicar
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readPdfPages } from "@/lib/import/pdf";
import { toDocumentLines } from "@/lib/import/layout";
import { dividirPorCliente, lerInvoiceSalesforce } from "@/lib/import/salesforce-invoice";
import { dedupHash, normalizeDescription } from "@/lib/dedup";
import { formatBRL, fromNumeric, toNumeric } from "@/lib/money";

loadEnvLocal();

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? undefined : process.argv[i + 1];
};
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const arquivo = arg("--arquivo");
const lancamento = arg("--lancamento");
if (!arquivo) throw new Error('uso: --arquivo "<invoice.pdf>" [--lancamento AAAA-MM-DD --ensaio|--aplicar]');

const usd = (c: bigint) => `US$ ${(Number(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const somaDias = (data: string, dias: number) =>
  new Date(Date.UTC(+data.slice(0, 4), +data.slice(5, 7) - 1, +data.slice(8, 10) + dias)).toISOString().slice(0, 10);

class Rollback extends Error {}
const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const inv = lerInvoiceSalesforce(
    toDocumentLines(await readPdfPages(new Uint8Array(readFileSync(arquivo)))).map((l) => l.text),
    basename(arquivo),
  );
  if (inv.clientes.length === 0) throw new Error("nenhum cliente lido na invoice — o formato mudou?");

  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const clientes = await sql<{ id: string; name: string }[]>`select id, name from clients where entity_id = ${entity!.id}`;
  // "SFA Medika" → Medika: o nome cadastrado tem de estar contido no da invoice, e um só.
  const casados = inv.clientes.map((c) => {
    const alvo = normalizeDescription(c.nome);
    const achados = clientes.filter((k) => alvo.includes(normalizeDescription(k.name)));
    return { ...c, cliente: achados.length === 1 ? achados[0]! : null, achados: achados.length };
  });

  console.log(`\nInvoice ${inv.numero ?? "?"} · vencimento ${inv.vencimento ?? "?"} · total ${usd(inv.totalUsd)}`);
  for (const c of casados) {
    console.log(`  ${usd(c.usd).padStart(14)}  ${c.nome.padEnd(28)} → ${c.cliente?.name ?? `?? (${c.achados} cadastros casam)`}`);
  }
  const semCliente = casados.filter((c) => !c.cliente);

  const centro = inv.vencimento ?? "2026-01-01";
  const candidatos = await sql<{ id: string; d: string; v: string; description: string; account_id: string; dedup_hash: string }[]>`
    select ce.id, ce.occurred_on::text as d, ce.amount::text as v, ce.description, ce.account_id, ce.dedup_hash
      from cash_entries ce join categories c on c.id = ce.category_id
     where ce.entity_id = ${entity!.id} and c.code = '3.03' and ce.direction = 'in'
       and ce.client_id is null
       and ce.occurred_on between ${somaDias(centro, -15)} and ${somaDias(centro, 45)}
     order by ce.occurred_on`;
  console.log(`\nRecebimentos em Receita Salesforce sem cliente, perto do vencimento:`);
  for (const c of candidatos) {
    const cambio = Number(fromNumeric(c.v)) / Number(inv.totalUsd);
    console.log(`  ${c.d}  ${formatBRL(fromNumeric(c.v)).padStart(16)}  câmbio R$ ${cambio.toFixed(4)}  ${c.description}`);
  }

  if (!lancamento) {
    console.log(`\nnada foi gravado. Aponte o recebimento com --lancamento AAAA-MM-DD.\n`);
  } else {
    const escolhidos = candidatos.filter((c) => c.d === lancamento);
    if (escolhidos.length !== 1) throw new Error(`esperava um recebimento em ${lancamento}, achei ${escolhidos.length}`);
    if (semCliente.length > 0) throw new Error(`cliente sem cadastro único: ${semCliente.map((c) => c.nome).join(", ")}`);
    const mae = escolhidos[0]!;
    const partes = dividirPorCliente(fromNumeric(mae.v), casados);
    console.log(`\nDivisão de ${formatBRL(fromNumeric(mae.v))} (${mae.d}):`);
    partes.forEach((p, i) => console.log(`  ${formatBRL(p.valor).padStart(14)}  ${casados[i]!.cliente!.name}`));

    const saldo = async (db: postgres.Sql | postgres.TransactionSql) => {
      const [r] = await db<{ s: string }[]>`
        select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)::text as s
          from cash_entries where account_id = ${mae.account_id}`;
      return fromNumeric(r!.s);
    };
    const antes = await saldo(sql);

    const write = async (db: postgres.TransactionSql) => {
      for (const [i, p] of partes.entries()) {
        const cliente = casados[i]!.cliente!;
        const descricao = `${mae.description} · invoice ${inv.numero ?? "?"}`;
        if (i === 0) {
          await db`update cash_entries set amount = ${toNumeric(p.valor)}, client_id = ${cliente.id},
                     description = ${descricao}, updated_at = now() where id = ${mae.id}`;
          continue;
        }
        await db`
          insert into cash_entries (entity_id, account_id, occurred_on, amount, direction, description,
                                    category_id, client_id, dedup_hash)
          select entity_id, account_id, occurred_on, ${toNumeric(p.valor)}, direction, ${descricao},
                 category_id, ${cliente.id},
                 ${dedupHash({ accountId: mae.account_id, occurredOn: mae.d, amount: p.valor, direction: "in", description: descricao, counterparty: cliente.name })}
            from cash_entries where id = ${mae.id}`;
      }
      const depois = await saldo(db);
      if (depois !== antes) throw new Error(`o saldo da conta mudaria de ${formatBRL(antes)} para ${formatBRL(depois)}`);
      console.log(`  trava ok — saldo da conta inalterado (${formatBRL(depois)})`);
    };

    if (REHEARSE) {
      await sql.begin(async (tx) => { await write(tx); throw new Rollback(); })
        .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
      console.log(`\nensaio: revertido, nada foi gravado.\n`);
    } else if (APPLY) {
      await sql.begin(write);
      console.log(`\ngravado.\n`);
    } else {
      console.log(`\nnada foi gravado. --ensaio para ensaiar, --aplicar para gravar.\n`);
    }
  }
} finally {
  await sql.end();
}
