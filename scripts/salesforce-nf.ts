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
 *
 * Um recebimento pode pagar **mais de uma invoice** (o FIN COMPRA de 24/09 pagou a 135 e a
 * 136): repita `--arquivo`. Quando a divisão só existe na imagem da tabela, ela entra por
 * `--clientes "Indigo=2990.60;Danke=2378.55"`, lida da imagem e confirmada pelo Andre.
 *
 * Nome da invoice que não bate com o cadastro: `--apelido "Touti=Kiosk Brand"` (a resposta do
 * Andre, nunca um palpite). Cliente novo só com `--cadastrar "Indigo"`, criado na mesma
 * transação — sem a palavra dele o script recusa, como sempre (D87).
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readPdfPages } from "@/lib/import/pdf";
import { toDocumentLines } from "@/lib/import/layout";
import { dividirPorCliente, lerClientesManuais, lerInvoiceSalesforce } from "@/lib/import/salesforce-invoice";
import { dedupHash, normalizeDescription } from "@/lib/dedup";
import { formatBRL, fromNumeric, toNumeric } from "@/lib/money";

loadEnvLocal();

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? undefined : process.argv[i + 1];
};
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const arquivos = process.argv.flatMap((a, i) => (a === "--arquivo" && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
const lancamento = arg("--lancamento");
const manuais = arg("--clientes");
const pares = (texto: string | undefined) =>
  new Map(
    (texto ?? "")
      .split(";")
      .map((p) => p.split("=").map((x) => x.trim()))
      .filter((p): p is [string, string] => p.length === 2 && p[0] !== "" && p[1] !== "")
      .map(([de, para]) => [normalizeDescription(de), para]),
  );
const apelidos = pares(arg("--apelido"));
const cadastrar = new Set((arg("--cadastrar") ?? "").split(";").map((n) => n.trim()).filter(Boolean));
if (arquivos.length === 0) throw new Error('uso: --arquivo "<invoice.pdf>" [--arquivo …] [--clientes "Nome=1234.56;…"] [--lancamento AAAA-MM-DD --ensaio|--aplicar]');

const usd = (c: bigint) => `US$ ${(Number(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const somaDias = (data: string, dias: number) =>
  new Date(Date.UTC(+data.slice(0, 4), +data.slice(5, 7) - 1, +data.slice(8, 10) + dias)).toISOString().slice(0, 10);

class Rollback extends Error {}
const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const lidas = await Promise.all(
    arquivos.map(async (arquivo) =>
      lerInvoiceSalesforce(
        toDocumentLines(await readPdfPages(new Uint8Array(readFileSync(arquivo)))).map((l) => l.text),
        basename(arquivo),
      ),
    ),
  );
  const extras = manuais ? lerClientesManuais(manuais) : [];
  const semLista = lidas.filter((i) => i.clientes.length === 0).map((i) => i.numero ?? "?");
  if (semLista.length > 0 && extras.length === 0) {
    throw new Error(`a divisão da invoice ${semLista.join(", ")} não está no texto do PDF — passe-a com --clientes`);
  }
  const clientesLidos = [...lidas.flatMap((i) => i.clientes), ...extras];
  const inv = {
    numero: lidas.map((i) => i.numero ?? "?").join("+"),
    vencimento: lidas.map((i) => i.vencimento).filter((v): v is string => v !== null).sort().at(-1) ?? null,
    clientes: clientesLidos,
    totalUsd: clientesLidos.reduce((a, c) => a + c.usd, 0n),
  };

  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const clientes = await sql<{ id: string; name: string }[]>`select id, name from clients where entity_id = ${entity!.id}`;
  // "SFA Medika" → Medika: o nome cadastrado tem de estar contido no da invoice, e um só. Um
  // apelido dito pelo Andre manda no lugar disso; `--cadastrar` marca o cliente a criar.
  type Alvo = { id: string | null; name: string };
  const casados = inv.clientes.map((c) => {
    const alvo = normalizeDescription(c.nome);
    const apelido = apelidos.get(alvo);
    if (apelido) {
      const achados = clientes.filter((k) => normalizeDescription(k.name) === normalizeDescription(apelido));
      return { ...c, cliente: (achados.length === 1 ? achados[0]! : null) as Alvo | null, achados: achados.length };
    }
    if (cadastrar.has(c.nome)) {
      if (clientes.some((k) => normalizeDescription(k.name) === alvo)) throw new Error(`${c.nome} já está cadastrado`);
      return { ...c, cliente: { id: null, name: c.nome } as Alvo | null, achados: 0 };
    }
    const achados = clientes.filter((k) => alvo.includes(normalizeDescription(k.name)));
    return { ...c, cliente: (achados.length === 1 ? achados[0]! : null) as Alvo | null, achados: achados.length };
  });

  console.log(`\nInvoice ${inv.numero ?? "?"} · vencimento ${inv.vencimento ?? "?"} · total ${usd(inv.totalUsd)}`);
  for (const c of casados) {
    console.log(
      `  ${usd(c.usd).padStart(14)}  ${c.nome.padEnd(28)} → ${c.cliente ? `${c.cliente.name}${c.cliente.id === null ? " (novo)" : ""}` : `?? (${c.achados} cadastros casam)`}`,
    );
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
      for (const c of casados) {
        if (c.cliente && c.cliente.id === null) {
          const [novo] = await db<{ id: string }[]>`
            insert into clients (entity_id, name) values (${entity!.id}, ${c.cliente.name}) returning id`;
          c.cliente.id = novo!.id;
          console.log(`  cliente novo: ${c.cliente.name}`);
        }
      }
      for (const [i, p] of partes.entries()) {
        const cliente = casados[i]!.cliente as { id: string; name: string };
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
