/**
 * Troca os lotes SISPAG pelos pagamentos que estão dentro deles.
 *
 * De janeiro a março de 2026 o extrato em XLSX entrega os pagamentos **agregados**: 34
 * linhas de `SISPAG FORNECEDORES` somando R$ 1.221.679,97, sem contraparte nenhuma. É 95%
 * de todo o custo que ainda não aparece na DRE, e nenhuma regra resolve, porque o nome não
 * está no arquivo.
 *
 * O nome está no **PDF do mesmo período** (D96), que a Q13 dava como ilegível e não era.
 * Este script lê o PDF, confere que a decomposição fecha, e troca as 34 linhas pelas 116.
 *
 * **O portão é a aritmética, e ele é intransigente:** para cada data, a soma dos pagamentos
 * itemizados tem de bater com o lote **ao centavo**. Uma data que não feche aborta o
 * script inteiro — não há aplicação parcial. Trocar linha de razão por aproximação seria
 * pior do que deixar o lote anônimo, porque o erro passaria a estar escondido dentro de um
 * dado que parece detalhado.
 *
 * O que ele não faz:
 *
 *   - **Não categoriza.** Insere os pagamentos com contraparte e documento, e para. Quem
 *     decide conta é o motor, e ele não alcança o razão (D88) — depois disto, o caminho é
 *     `propose:receipts` e as regras por documento.
 *   - **Não inventa nome.** Oito pagamentos, R$ 95.950,00, o próprio PDF não nomeia. Eles
 *     entram sem contraparte, como estão.
 *
 * O saldo não pode mudar: sai R$ 1.221.679,97 em 34 linhas, entra o mesmo em 116. O script
 * mede antes e depois e reclama se mudar.
 *
 *   npm run import:sispag
 *   npm run import:sispag -- --ensaio
 *   npm run import:sispag -- --aplicar
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, toNumeric, type Cents } from "@/lib/money";
import { dedupHash } from "@/lib/dedup";
import { readItauStatementPdf, pdfCoverage } from "@/lib/import/itau-statement-pdf";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const FILE =
  process.argv.find((a) => a.endsWith(".pdf")) ??
  "docs/reference/Janeiro ate março_pdf (1).pdf";

const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/** Abaixo disto o PDF não é o que este leitor entende, e ler seria inventar. */
const MIN_COVERAGE = 0.9;

/** As descrições que o razão usa para os lotes. */
const LOTE = /SISPAG|PAGAMENTOS A FORNECEDORES/;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });

const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

try {
  const pdf = readFileSync(FILE);
  const cobertura = pdfCoverage(pdf);
  console.log(`\n${BOLD}${FILE}${RESET}`);
  console.log(`  cobertura de glifos: ${(cobertura * 100).toFixed(1)}%`);
  if (cobertura < MIN_COVERAGE) {
    throw new Error(
      `cobertura abaixo de ${(MIN_COVERAGE * 100).toFixed(0)}% — este PDF não foi produzido ` +
        `pelo mesmo gerador, e decodificá-lo daria nomes plausíveis e errados`,
    );
  }

  const pagamentos = readItauStatementPdf(pdf).filter((r) => LOTE.test(r.description));
  console.log(`  ${pagamentos.length} pagamentos itemizados`);

  // ---- O portão: cada data tem de fechar ao centavo ------------------------
  const lotes = await sql<
    { id: string; occurred_on: Date; amount: string; description: string; entity_id: string; account_id: string }[]
  >`
    select id, occurred_on, amount, description, entity_id, account_id
    from cash_entries
    where upper(description) like '%SISPAG%'
       or upper(description) like '%PAGAMENTOS A FORNECEDORES%'
    order by occurred_on`;

  const noRazao = new Map<string, Cents>();
  for (const l of lotes) {
    const d = iso(l.occurred_on);
    noRazao.set(d, (noRazao.get(d) ?? 0n) + fromNumeric(l.amount));
  }
  const noPdf = new Map<string, Cents>();
  for (const p of pagamentos) {
    const v = p.amount < 0n ? -p.amount : p.amount;
    noPdf.set(p.occurredOn, (noPdf.get(p.occurredOn) ?? 0n) + v);
  }

  const datas = [...new Set([...noRazao.keys(), ...noPdf.keys()])].sort();
  const divergentes: string[] = [];
  console.log(`\n${BOLD}conferência por data${RESET}`);
  for (const d of datas) {
    const r = noRazao.get(d) ?? 0n;
    const p = noPdf.get(d) ?? 0n;
    const ok = r === p;
    if (!ok) divergentes.push(d);
    console.log(
      `  ${ok ? GREEN + "OK  " + RESET : RED + "FALHA" + RESET} ${d}  razão ${formatBRL(r).padStart(14)}  PDF ${formatBRL(p).padStart(14)}`,
    );
  }

  const totalRazao = [...noRazao.values()].reduce((a, b) => a + b, 0n);
  const totalPdf = [...noPdf.values()].reduce((a, b) => a + b, 0n);
  console.log(
    `\n  ${datas.length - divergentes.length} de ${datas.length} datas fecham · razão ${formatBRL(totalRazao)} · PDF ${formatBRL(totalPdf)}`,
  );

  if (divergentes.length > 0) {
    throw new Error(
      `${divergentes.length} datas não fecham (${divergentes.join(", ")}). ` +
        `Nada foi gravado: trocar linha de razão por aproximação esconderia o erro dentro ` +
        `de um dado que parece detalhado.`,
    );
  }

  const semNome = pagamentos.filter((p) => p.counterpartyTaxId === null);
  const semNomeTotal = semNome.reduce((s, p) => s + (p.amount < 0n ? -p.amount : p.amount), 0n);
  console.log(
    `  ${GREEN}a decomposição fecha ao centavo${RESET} · ${semNome.length} pagamentos o PDF não nomeia (${formatBRL(semNomeTotal)})`,
  );

  const primeiro = lotes[0];
  if (!primeiro) throw new Error("nenhum lote no razão — nada a trocar");

  async function saldo(db: postgres.Sql | postgres.TransactionSql): Promise<Cents> {
    const [row] = await db<{ saldo: string }[]>`
      select (a.opening_balance +
              coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0)) as saldo
      from accounts a
      left join cash_entries e on e.account_id = a.id
      where a.id = ${primeiro!.account_id}
      group by a.id, a.opening_balance`;
    return row ? fromNumeric(row.saldo) : 0n;
  }

  const antes = await saldo(sql);

  if (!APPLY && !REHEARSE) {
    console.log(
      `\n${YELLOW}${lotes.length} linhas de lote sairiam, ${pagamentos.length} pagamentos entrariam.${RESET}`,
    );
    console.log(`${DIM}nada foi gravado. Rode com --ensaio para medir, ou --aplicar.${RESET}\n`);
  } else {
    const write = async (db: postgres.TransactionSql) => {
      const [imp] = await db<{ id: string }[]>`
        insert into statement_imports ${db({
          entity_id: primeiro!.entity_id,
          account_id: primeiro!.account_id,
          filename: FILE.split("/").pop() ?? FILE,
          file_hash: createHash("sha256").update(pdf).digest("hex"),
          format: "pdf",
          period_start: datas[0] ?? null,
          period_end: datas[datas.length - 1] ?? null,
          status: "approved",
        })} returning id`;

      await db`delete from cash_entries where id in ${db(lotes.map((l) => l.id))}`;

      // D78: o hash precisa da contraparte e de um índice de ocorrência, ou dois
      // pagamentos iguais no mesmo dia viram "um e uma duplicata".
      const vistos = new Map<string, number>();
      for (const p of pagamentos) {
        const magnitude = p.amount < 0n ? -p.amount : p.amount;
        const chave = `${p.occurredOn}|${magnitude}|${p.counterpartyTaxId ?? p.counterpartyName ?? ""}`;
        const suffix = vistos.get(chave) ?? 0;
        vistos.set(chave, suffix + 1);

        await db`insert into cash_entries ${db({
          entity_id: primeiro!.entity_id,
          account_id: primeiro!.account_id,
          occurred_on: p.occurredOn,
          amount: toNumeric(magnitude),
          direction: p.amount < 0n ? "out" : "in",
          description: p.description,
          counterparty_name: p.counterpartyName,
          counterparty_tax_id: p.counterpartyTaxId,
          import_id: imp!.id,
          dedup_hash: dedupHash({
            accountId: primeiro!.account_id,
            occurredOn: p.occurredOn,
            amount: magnitude,
            direction: p.amount < 0n ? "out" : "in",
            description: p.description,
            counterparty: p.counterpartyTaxId ?? p.counterpartyName,
            suffix,
          }),
        })}`;
      }
      return saldo(db);
    };

    let depois = antes;
    if (REHEARSE) {
      const ROLLBACK = Symbol("ensaio");
      try {
        await sql.begin(async (db) => {
          depois = await write(db);
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
    } else {
      depois = await sql.begin(write);
    }

    console.log(
      `\n${BOLD}${REHEARSE ? "Ensaio (revertido)" : "Aplicado"}${RESET} — ` +
        `${lotes.length} lotes fora, ${pagamentos.length} pagamentos dentro.`,
    );
    console.log(`  saldo antes .... ${formatBRL(antes)}`);
    console.log(`  saldo depois ... ${formatBRL(depois)}`);
    console.log(
      antes === depois
        ? `  ${GREEN}o saldo não mudou — a conciliação com o extrato continua de pé.${RESET}\n`
        : `  ${RED}o saldo mudou. Isso não deveria acontecer.${RESET}\n`,
    );
    if (!REHEARSE) {
      console.log(
        `${DIM}Agora: ${RESET}npm run propose:receipts${DIM} e ${RESET}npm run decisoes${DIM} — ` +
          `26 das 49 contrapartes já são pessoa ou cliente cadastrado.${RESET}\n`,
      );
    }
  }
} finally {
  await sql.end();
}
