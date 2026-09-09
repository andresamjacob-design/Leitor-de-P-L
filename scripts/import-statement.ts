/**
 * Loads the real bank statements from `docs/reference/` into `staged_transactions`.
 *
 * O irmão do `import-invoices.ts`, do outro lado: aquele carrega fatura de cartão, este
 * carrega extrato de conta corrente. Até agora o extrato só entrava pela tela, um arquivo
 * por vez — e isso basta enquanto é um arquivo por mês, mas deixa de bastar quando é
 * preciso **mostrar o que aconteceria antes de gravar**, que é o que a tela não faz e o
 * `--ensaio` faz.
 *
 * Faz o mesmo que a tela faz, pelas mesmas funções: mesmos parsers, mesma reconciliação,
 * mesmo hash de deduplicação, mesmo `pending` esperando um humano. **Nada chega a tabela
 * de razão** (SPEC §7).
 *
 * Duas diferenças de propósito em relação ao irmão:
 *
 *   - **Extrato que não fecha é aviso, não recusa.** A fatura de cartão é recusada quando
 *     não bate com o total impresso nela (D-B), porque ali o total é uma afirmação do
 *     documento sobre si mesmo. O extrato é o registro do próprio banco: se a leitura não
 *     bate com o saldo declarado em algum dia, quem precisa saber é o leitor, e o arquivo
 *     continua sendo a melhor fonte que existe. É como a tela já trata (`actions.ts`).
 *   - **O saldo de fechamento é o da data mais recente, não a última linha do arquivo.**
 *     O export do Itaú vem do mais novo para o mais antigo (D81).
 *
 * **E ele pede que você nomeie o arquivo.** Aqui está a terceira diferença, e é de
 * desenho: fatura é documento discreto — cada uma cobre o seu período —, então "importe
 * tudo que ainda não importei" é a regra certa lá. **Extrato se sobrepõe por natureza:** o
 * mesmo movimento aparece em vários exports do mesmo banco, e a pasta guarda exports
 * antigos cujo conteúdo já está no razão mas cujo hash de arquivo nunca foi registrado.
 * Identidade por hash é do arquivo, não do conteúdo. Sem `--arquivo`, o script lista o que
 * encontrou e não grava nada.
 *
 *   npm run import:extrato                                  # lista o que há
 *   npm run import:extrato -- --arquivo 08-09-26            # mostra o que faria
 *   npm run import:extrato -- --arquivo 08-09-26 --ensaio   # ensaia e reverte
 *   npm run import:extrato -- --arquivo 08-09-26 --aplicar
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { parseItauStatement, reconcileStatement } from "@/lib/import/itau-statement";
import { dedupHash } from "@/lib/dedup";
import { formatMoney, toNumeric, type Cents } from "@/lib/money";
import type { StatementParse } from "@/lib/import/types";

loadEnvLocal();

const DIRECTORY = process.env["REFERENCE_DIR"] ?? "docs/reference";
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
/** Trecho do nome do arquivo a importar. Sem ele o script só lista. */
const ONLY = (() => {
  const at = process.argv.indexOf("--arquivo");
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
})();

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/** Thrown to undo everything the rehearsal inserted. */
class Rollback extends Error {}

const digits = (value: string) => value.replace(/\D/g, "");

type Statement = {
  filename: string;
  fileHash: string;
  parse: StatementParse;
  /** O número da conta, lido de dentro do arquivo — nunca do nome dele. */
  accountNumber: string | null;
  closingBalance: Cents | null;
  /** Dias em que a leitura não bate com o saldo que o extrato declara. */
  failures: number;
  reconciliation: string;
};

function read(): { statements: Statement[]; skipped: string[] } {
  let entries: string[];
  try {
    entries = readdirSync(DIRECTORY).filter((name) => statSync(join(DIRECTORY, name)).isFile());
  } catch {
    throw new Error(`${DIRECTORY} não existe — nada a importar.`);
  }

  const statements: Statement[] = [];
  const skipped: string[] = [];

  for (const name of entries.filter((e) => e.toLowerCase().endsWith(".xlsx")).sort()) {
    const bytes = new Uint8Array(readFileSync(join(DIRECTORY, name)));

    let parse: StatementParse;
    try {
      parse = parseItauStatement(readXlsx(bytes)[0]?.rows ?? []);
    } catch {
      skipped.push(`${name} — não é um extrato`);
      continue;
    }
    const fatal = parse.warnings.find((w) => w.severity === "error");
    if (fatal) {
      skipped.push(`${name} — ${fatal.message}`);
      continue;
    }
    if (parse.transactions.length === 0) {
      skipped.push(`${name} — lido, mas sem nenhum lançamento`);
      continue;
    }

    const check = reconcileStatement(parse);
    // O saldo de fechamento é o da data mais recente, não a última linha (D81).
    const closing = parse.declaredBalances.reduce<(typeof parse.declaredBalances)[number] | null>(
      (latest, c) => (latest === null || c.date > latest.date ? c : latest),
      null,
    );

    statements.push({
      filename: name,
      fileHash: createHash("sha256").update(bytes).digest("hex"),
      parse,
      accountNumber: parse.source.account,
      closingBalance: closing?.balance ?? null,
      failures: check.failures.length,
      reconciliation: check.message,
    });
  }

  return { statements, skipped };
}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");
  const entityId = entity.id;

  const [user] = await sql<{ id: string }[]>`
    select user_id as id from user_entities where entity_id = ${entityId} limit 1`;
  const userId = user?.id ?? null;

  const accounts = await sql<
    { id: string; name: string; number: string | null; lastDigits: string | null }[]
  >`
    select id, name, number, last_digits as "lastDigits" from accounts
     where entity_id = ${entityId} and type in ('bank', 'cash', 'investment')`;
  /**
   * Casa pelo **número inteiro** da conta, e só depois pelos quatro últimos dígitos.
   *
   * A ordem importa por causa do dígito verificador: a conta `0098873-4` foi semeada com
   * `last_digits = 8873` (o número sem o verificador), enquanto os quatro últimos dígitos
   * de tudo que é dígito dão `8734`. As duas convenções são defensáveis e nenhuma é
   * errada — por isso o número inteiro, que não tem essa ambiguidade, vem primeiro.
   *
   * A tela nunca precisou disto: lá um humano escolhe a conta num seletor, e a diferença
   * de dígitos vira um aviso, não um casamento (`actions.ts`). Um script não tem humano.
   */
  const byNumber = new Map(
    accounts.filter((a) => a.number).map((a) => [digits(a.number!), a]),
  );
  const byLastFour = new Map(
    accounts.filter((a) => a.lastDigits).map((a) => [a.lastDigits!, a]),
  );
  const findAccount = (number: string | null) => {
    if (!number) return undefined;
    const d = digits(number);
    return byNumber.get(d) ?? byLastFour.get(d.slice(-4));
  };

  const already = await sql<{ fileHash: string }[]>`
    select file_hash as "fileHash" from statement_imports where entity_id = ${entityId}`;
  const seen = new Set(already.map((r) => r.fileHash));

  const { statements, skipped } = read();
  console.log(`\n${BOLD}${statements.length} extrato(s) em ${DIRECTORY}${RESET}\n`);

  const pending: Statement[] = [];
  let totalLines = 0;

  for (const s of statements) {
    const account = findAccount(s.accountNumber);
    const done = seen.has(s.fileHash);
    const chosen = ONLY !== null && s.filename.includes(ONLY);
    if (account && !done && chosen) {
      pending.push(s);
      totalLines += s.parse.transactions.length;
    }

    const status = !account
      ? `${RED}sem conta cadastrada para ${s.accountNumber ?? "conta ilegível"}${RESET}`
      : done
        ? `${YELLOW}já importado${RESET}`
        : chosen
          ? `${GREEN}importar${RESET}`
          : `${DIM}não escolhido${RESET}`;

    console.log(
      `  ${s.filename.slice(0, 40).padEnd(40)} ` +
        `${String(s.parse.transactions.length).padStart(3)} mov  ` +
        `${s.parse.periodStart ?? "?"} a ${s.parse.periodEnd ?? "?"}  ` +
        `${(s.closingBalance === null ? "—" : formatMoney(s.closingBalance)).padStart(13)}  ${status}`,
    );
    if (s.failures > 0) console.log(`      ${YELLOW}${s.reconciliation}${RESET}`);
  }

  if (skipped.length > 0) {
    console.log(`\n${DIM}ignorados: ${skipped.length} arquivo(s) que não são extrato${RESET}`);
  }
  console.log(`\n${BOLD}${pending.length} extrato(s) a importar, ${totalLines} movimentos.${RESET}`);

  /** Espelha `stageImport`/`stageRows` em src/lib/data/imports.ts. */
  async function write(db: Sql): Promise<{ imports: number; lines: number; duplicates: number }> {
    let imports = 0;
    let lines = 0;
    let duplicates = 0;

    for (const s of pending) {
      const account = findAccount(s.accountNumber)!;
      const inserted = await db<{ id: string }[]>`
        insert into statement_imports
          (entity_id, account_id, filename, file_hash, format, period_start, period_end,
           statement_closing_balance, status, imported_by)
        values (${entityId}, ${account.id}, ${s.filename}, ${s.fileHash}, 'xlsx',
                ${s.parse.periodStart}, ${s.parse.periodEnd},
                ${s.closingBalance === null ? null : toNumeric(s.closingBalance)},
                'reviewing', ${userId})
        returning id`;
      const importId = inserted[0]?.id;
      if (!importId) throw new Error(`não foi possível registrar ${s.filename}`);
      imports += 1;

      // Quatro PIX de R$ 4.000 no mesmo dia são quatro pagamentos, não uma linha e três
      // duplicatas: cada repetição leva o próximo índice de ocorrência (D78).
      const occurrences = new Map<string, number>();
      const hashes = s.parse.transactions.map((t) => {
        const subject = {
          accountId: account.id,
          occurredOn: t.occurredOn,
          amount: t.amount,
          direction: t.direction,
          description: t.description,
          counterparty: t.counterpartyTaxId ?? t.counterpartyName,
        };
        const key = dedupHash(subject);
        const index = occurrences.get(key) ?? 0;
        occurrences.set(key, index + 1);
        return dedupHash({ ...subject, suffix: index });
      });

      // Só o que já está no razão conta como duplicata.
      const inLedger = await db<{ dedupHash: string }[]>`
        select dedup_hash as "dedupHash" from cash_entries
         where entity_id = ${entityId} and dedup_hash = any(${hashes})`;
      const existing = new Set(inLedger.map((r) => r.dedupHash));

      for (const [index, t] of s.parse.transactions.entries()) {
        const hash = hashes[index] as string;
        const isDuplicate = existing.has(hash);
        if (isDuplicate) duplicates += 1;

        await db`
          insert into staged_transactions
            (entity_id, import_id, occurred_on, description, amount, counterparty_name,
             counterparty_tax_id, installment_current, installment_total, external_id,
             dedup_hash, status, raw_json)
          values (${entityId}, ${importId}, ${t.occurredOn}, ${t.description},
                  ${toNumeric(t.direction === "out" ? -t.amount : t.amount)},
                  ${t.counterpartyName}, ${t.counterpartyTaxId},
                  ${t.installmentCurrent}, ${t.installmentTotal}, ${t.externalId}, ${hash},
                  ${isDuplicate ? "duplicate" : "pending"}, ${db.json(t.raw)})`;
        lines += 1;
      }
    }

    return { imports, lines, duplicates };
  }

  if (pending.length === 0) {
    console.log(
      ONLY === null
        ? `\n${DIM}nenhum arquivo escolhido. Use --arquivo <trecho do nome> para escolher.${RESET}\n`
        : `\n${DIM}nada a fazer.${RESET}\n`,
    );
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --ensaio para ensaiar numa transação revertida, ` +
        `ou --aplicar para importar.${RESET}\n`,
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
                imports: number;
                lines: number;
                duplicates: number;
              };
            }
            throw error;
          })
      : write(sql));

    console.log(
      `\n${GREEN}${done.imports} extrato(s) e ${done.lines} movimentos ` +
        `${REHEARSE ? "seriam importados" : "importados"}${RESET}` +
        `${done.duplicates > 0 ? `, ${done.duplicates} marcados como duplicata` : ""}.`,
    );
    if (REHEARSE) console.log(`${DIM}ensaio: a transação foi revertida, nada foi gravado.${RESET}\n`);
    else console.log("");
  }
} finally {
  await sql.end();
}
