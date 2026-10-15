/**
 * O razão contra o banco, dia a dia (D147).
 *
 * A prioridade do Andre (D136) é que o app nunca tenha diferença com o banco. A aprovação
 * automática (D145) confere **um** ponto por arquivo — o último fechamento — na hora do
 * envio. Isto confere **todos** os fechamentos que o extrato declara, a qualquer momento:
 * para cada `SALDO TOTAL DISPONÍVEL DIA`, o saldo de abertura da conta (se ela já estava
 * aberta) mais todo lançamento até aquele dia.
 *
 * Só lê. A conta é a do número impresso no arquivo; `SALDO EM CONTA CORRENTE` fica de fora
 * porque é fotografia da exportação, não fechamento de dia (D145).
 *
 *   npm run conferir:banco -- ~/Downloads/Entradas_Saidas_*.xlsx
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { parseItauStatement } from "@/lib/import/itau-statement";
import { formatBRL, fromNumeric, type Cents } from "@/lib/money";

loadEnvLocal();

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const arquivos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (arquivos.length === 0) throw new Error("passe um ou mais extratos .xlsx do Itaú");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

const digitos = (s: string | null) => (s ?? "").replace(/\D/g, "");

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");
  const contas = await sql<{ id: string; name: string; number: string | null; ob: string; od: string }[]>`
    select id, name, number, opening_balance::text as ob, opening_date::text as od
      from accounts where entity_id = ${entity.id} and type = 'bank'`;

  // Dia → fechamento declarado, por conta. Arquivos se sobrepõem; o mesmo dia vale uma vez.
  const declarados = new Map<string, Map<string, Cents>>();
  for (const caminho of arquivos) {
    const parse = parseItauStatement(readXlsx(new Uint8Array(readFileSync(caminho)))[0]?.rows ?? []);
    const numero = digitos(parse.source.account);
    const conta = contas.find((c) => numero !== "" && digitos(c.number).endsWith(numero.slice(-6)));
    if (!conta) {
      console.log(`${RED}sem conta para ${caminho} (${parse.source.account ?? "?"})${RESET}`);
      continue;
    }
    const dias = declarados.get(conta.id) ?? new Map<string, Cents>();
    for (const b of parse.declaredBalances) {
      if (/saldo em conta corrente/i.test(b.label)) continue;
      const antes = dias.get(b.date);
      if (antes !== undefined && antes !== b.balance) {
        console.log(`${RED}${conta.name} ${b.date}: dois arquivos declaram saldos diferentes${RESET}`);
      }
      dias.set(b.date, b.balance);
    }
    declarados.set(conta.id, dias);
  }

  let divergentes = 0;
  for (const [contaId, dias] of declarados) {
    const conta = contas.find((c) => c.id === contaId)!;
    const movimentos = await sql<{ d: string; v: string }[]>`
      select occurred_on::text as d,
             sum(case when direction = 'in' then amount else -amount end)::text as v
        from cash_entries where account_id = ${contaId}
       group by occurred_on order by occurred_on`;
    const abertura = fromNumeric(conta.ob);

    console.log(`\n${BOLD}${conta.name}${RESET} ${DIM}— abertura ${formatBRL(abertura)} em ${conta.od}${RESET}`);
    for (const [dia, banco] of [...dias].sort(([a], [b]) => a.localeCompare(b))) {
      const app =
        (conta.od <= dia ? abertura : 0n) +
        movimentos.filter((m) => m.d <= dia).reduce((a, m) => a + fromNumeric(m.v), 0n);
      const diferenca = app - banco;
      if (diferenca !== 0n) divergentes += 1;
      console.log(
        `  ${dia}  banco ${formatBRL(banco).padStart(16)}  app ${formatBRL(app).padStart(16)}  ` +
          (diferenca === 0n ? `${GREEN}=${RESET}` : `${RED}${formatBRL(diferenca)}${RESET}`),
      );
    }
  }

  console.log(
    divergentes === 0
      ? `\n${GREEN}${BOLD}todos os dias batem com o banco, ao centavo.${RESET}\n`
      : `\n${RED}${BOLD}${divergentes} dia(s) diferentes do banco.${RESET}\n`,
  );
  process.exitCode = divergentes === 0 ? 0 : 1;
} finally {
  await sql.end();
}
