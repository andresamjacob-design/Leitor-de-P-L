/**
 * Turns the cost block of the `DRE Geral` sheet into categorisation rules.
 *
 * The spreadsheet already carries the judgement someone made by hand, one line per
 * supplier — Clicksign, Gsuite, Salesforce, Uber. The chart of accounts was derived from
 * those same lines, so each one maps onto a code. What is missing is the bridge between
 * the supplier's name in the sheet and how it is written in a statement, and that is what
 * the aliases below are.
 *
 * It **proposes**. Nothing is written unless `--aplicar` is passed, and even then the
 * rules only produce suggestions — a rule never approves anything by itself.
 *
 *   npm run propose:rules              # mostra o que faria
 *   npm run propose:rules -- --aplicar # grava as regras
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { normalizeDescription } from "@/lib/dedup";

loadEnvLocal();

const SPREADSHEET = "docs/reference/Claude de DRE - Dynamics Data 2026.xlsx";
const APPLY = process.argv.includes("--aplicar");

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const RESET = "[0m";

/**
 * Which way the money went, from the signed amount.
 *
 * `amount` arrives as text straight from the driver — `numeric` is never read as a JS
 * number here, for the reason D77 records: a float round-trip once turned R$ 800,00 into
 * R$ 80,80 across 327 lines. The sign is all this needs, and the sign survives in text.
 */
function directionOf(amount: string): Direction {
  return amount.trim().startsWith("-") ? "out" : "in";
}

/**
 * How each cost line of the sheet is written in a bank statement or a card invoice.
 *
 * Read off the real files: the card prints `DL *GOOGLE Workspacedd` for what the sheet
 * calls Gsuite, and `EBN*Canva04748 36` for Canva. A line with no alias falls back to its
 * own name, which is right for the ones that match already (Adobe, Slack).
 */
const ALIASES: Record<string, string[]> = {
  Gsuite: ["GOOGLE"],
  ChatGPT: ["OPENAI", "CHATGPT"],
  Claude: ["CLAUDE.AI", "ANTHROPIC"],
  "Uber e Transporte": ["UBER"],
  "Claro e TIM": ["CLARO", "TIM*"],
  Passagem: ["AZUL LINHAS", "FLY*", "MAXMILHAS", "GOL "],
  Hotels: ["HOTEL"],
  Alimentação: [],
  // The statement truncates the counterparty, so `ATTENTIVE CONTABILIDADE` never matches:
  // it arrives as `BOLETO PAGO ATTENTIVE CO`. The prefix alone is enough, and it also
  // catches `ATTENTIVE SERVICOS ADMINISTRAT`, which is the same office billing separately.
  Contabilidade: ["ATTENTIVE"],
  "Agência Ciclo": ["CICLO"],
  "Bank Charges": ["TAR CAMB", "TARIFA"],
  IOF: ["IOF"],
  Freelancers: [],
  Juridico: [],
  Brindes: [],
  "Job Materials": [],
  "Travel Meals": [],
  Entertainment: [],
  Outros: [],
  "Reembolsos Comercial": [],
  Salários: [],
  Férias: [],
  "13º Salário": [],
  "Plano de Saude": [],
  "Seguro Saúde (estag)": [],
  "Ticket Restaurante": [],
  VT: [],
  "Penalties & Settlements": [],
};

/** Sheet line → chart of accounts code. The chart was built from these very lines. */
const TO_CODE: Record<string, string> = {
  Salários: "6.02",
  Férias: "6.03",
  "13º Salário": "6.04",
  "Plano de Saude": "6.06",
  "Seguro Saúde (estag)": "6.07",
  "Ticket Restaurante": "6.08",
  VT: "6.09",
  Freelancers: "6.10",
  Clicksign: "7.07",
  Gsuite: "7.01",
  Wix: "7.10",
  Slack: "7.05",
  Tarefy: "7.08",
  Plaud: "7.14",
  Salesforce: "7.02",
  Adobe: "7.11",
  "Escola.i": "7.09",
  Claude: "7.03",
  Trello: "7.06",
  Canva: "7.12",
  Vindi: "7.13",
  NeverBounce: "7.15",
  Scribd: "7.16",
  ChatGPT: "7.04",
  Locaweb: "7.17",
  Tactic: "7.18",
  "Railway Corporation": "7.19",
  Linkedin: "7.20",
  Contabilidade: "8.01",
  Juridico: "8.02",
  "Agência Ciclo": "8.03",
  Passagem: "9.01",
  Hotels: "9.02",
  Alimentação: "9.03",
  "Travel Meals": "9.03",
  "Uber e Transporte": "9.04",
  "Viagem e evento": "9.05",
  Entertainment: "9.06",
  "Claro e TIM": "10.01",
  Brindes: "10.02",
  "Job Materials": "10.03",
  "Reembolsos Comercial": "10.04",
  Outros: "10.05",
  "Bank Charges": "11.01",
  IOF: "11.02",
  "Penalties & Settlements": "11.03",
  Maquinas: "5.01",
};

/**
 * Rules that come from the statement's own vocabulary, not from the sheet.
 *
 * The card bill debit is the one that matters most: `BUSINESS 7502-5632` is the 5780
 * account and `BUSINESS 4005-1044` is the 8299 one, and both are transfers — booking them
 * as expense would double-count every purchase already on the invoice (D-C).
 */
const STATEMENT_RULES: { pattern: string; code: string; direction: Direction; note: string }[] = [
  { pattern: "BUSINESS 7502-5632", code: "99.02", direction: "out", note: "débito da fatura do cartão 5780" },
  { pattern: "BUSINESS 4005-1044", code: "99.02", direction: "out", note: "débito da fatura do cartão 8299" },
  // Same account, opposite sides: the sweep out and the sweep back. Without a direction
  // one of them would swallow the other's lines.
  { pattern: "APLICACAO CDB", code: "99.03", direction: "out", note: "aplicação no CDB" },
  { pattern: "RESGATE CDB", code: "99.03", direction: "in", note: "resgate do CDB" },
  { pattern: "APLICACAO TRUST", code: "99.03", direction: "out", note: "aplicação" },
  { pattern: "PAGAMENTOS TRIB", code: "4.01", direction: "out", note: "tributo pago por código de barras" },
  { pattern: "ANUIDADE", code: "11.01", direction: "out", note: "anuidade do cartão" },
];

type Direction = "in" | "out";

type Proposal = {
  pattern: string;
  code: string;
  direction: Direction;
  source: "planilha" | "extrato";
  note: string;
};

function cleanLabel(raw: string): string {
  return raw
    .replace(/^[-–]\s*/, "")
    .replace(/\((cart[ãa]o de credito|cart[ãa]o|boleto|outras empresas|estag)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readSheetLines(): { label: string; code: string }[] {
  const sheets = readXlsx(new Uint8Array(readFileSync(SPREADSHEET)));
  const dre = sheets.find((sheet) => sheet.name === "DRE Geral");
  if (!dre) throw new Error("aba “DRE Geral” não encontrada");

  const found: { label: string; code: string }[] = [];
  for (const row of dre.rows) {
    const raw = String(row[2] ?? "").trim();
    if (!raw.startsWith("-") && raw !== "Maquinas") continue;

    const label = cleanLabel(raw);
    const code = TO_CODE[label];
    if (code) found.push({ label, code });
  }
  return found;
}

function proposalsFrom(lines: { label: string; code: string }[]): Proposal[] {
  const out: Proposal[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const patterns = ALIASES[line.label] ?? [line.label];
    const list = patterns.length > 0 ? patterns : [];

    for (const pattern of list) {
      const key = normalizeDescription(pattern);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      // Every one of these comes from the *cost* block of the sheet, so it describes money
      // leaving. Saying so is what keeps `CICLO` from booking the five Ciclo receipts as
      // agency expense — the partner's name never says which way the money went.
      out.push({ pattern, code: line.code, direction: "out", source: "planilha", note: line.label });
    }
  }

  for (const rule of STATEMENT_RULES) {
    const key = normalizeDescription(rule.pattern);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      pattern: rule.pattern,
      code: rule.code,
      direction: rule.direction,
      source: "extrato",
      note: rule.note,
    });
  }

  return out;
}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const entities = await sql<{ id: string; slug: string }[]>`
    select id, slug from entities where slug = 'dd-group'`;
  const entity = entities[0];
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");

  const categories = await sql<{ id: string; code: string; name: string }[]>`
    select id, code, name from categories where entity_id = ${entity.id}`;
  const byCode = new Map(categories.map((category) => [category.code, category]));

  const staged = await sql<{ description: string; amount: string }[]>`
    select description, amount::text from staged_transactions where entity_id = ${entity.id}`;

  const proposals = proposalsFrom(readSheetLines());

  console.log(`${proposals.length} regras propostas, contra ${staged.length} linhas importadas\n`);

  const claimed = new Set<number>();
  let matchedRules = 0;

  for (const proposal of proposals) {
    const category = byCode.get(proposal.code);
    if (!category) {
      console.log(`  ${DIM}sem conta ${proposal.code} no plano — “${proposal.pattern}” ignorada${RESET}`);
      continue;
    }

    const needle = normalizeDescription(proposal.pattern);
    const hits: number[] = [];
    // Lines the text matches but the direction rejects. Counting them separately is the
    // point of the preview: it shows what the rule *would* have swallowed before 0004.
    let blocked = 0;
    for (const [index, row] of staged.entries()) {
      if (!normalizeDescription(row.description).includes(needle)) continue;
      if (directionOf(row.amount) !== proposal.direction) {
        blocked += 1;
        continue;
      }
      hits.push(index);
    }
    for (const index of hits) claimed.add(index);
    if (hits.length > 0) matchedRules += 1;

    const sample = hits.slice(0, 2).map((index) => staged[index]?.description ?? "").join(" · ");
    const arrow = proposal.direction === "out" ? "↓" : "↑";
    console.log(
      `  ${hits.length > 0 ? GREEN : DIM}${String(hits.length).padStart(4)}${RESET} ${arrow} ` +
        `${proposal.pattern.padEnd(24)} → ${proposal.code} ${category.name.padEnd(26)}` +
        `${blocked > 0 ? `${RED}${String(blocked).padStart(3)} barradas${RESET} ` : "           "}` +
        `${DIM}${sample.slice(0, 40)}${RESET}`,
    );
  }

  const remaining = staged.filter((_, index) => !claimed.has(index));
  console.log(
    `\n${claimed.size} de ${staged.length} linhas seriam categorizadas ` +
      `por ${matchedRules} regras. ${remaining.length} continuam sem categoria.`,
  );

  // What is left is the honest part: the descriptions nobody taught the system yet.
  const rest = new Map<string, number>();
  for (const row of remaining) {
    const key = normalizeDescription(row.description).split(" ").slice(0, 3).join(" ");
    rest.set(key, (rest.get(key) ?? 0) + 1);
  }
  console.log("\nO que sobra, por frequência:");
  for (const [label, count] of [...rest].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(count).padStart(4)}  ${label}`);
  }

  if (!APPLY) {
    console.log(`\n${DIM}nada foi gravado. Rode com --aplicar para criar as regras.${RESET}`);
  } else {
    let created = 0;
    for (const proposal of proposals) {
      const category = byCode.get(proposal.code);
      if (!category) continue;

      const exists = await sql`
        select 1 from categorization_rules
        where entity_id = ${entity.id} and pattern = ${proposal.pattern} limit 1`;
      if (exists.length > 0) continue;

      await sql`
        insert into categorization_rules
          (entity_id, priority, match_type, pattern, category_id, direction, active)
        values (${entity.id}, ${proposal.source === "extrato" ? 50 : 100}, 'contains',
                ${proposal.pattern}, ${category.id}, ${proposal.direction}, true)`;
      created += 1;
    }
    console.log(`\n${GREEN}${created} regras criadas.${RESET} Use “Categorizar” na tela de Regras.`);
  }
} finally {
  await sql.end();
}
