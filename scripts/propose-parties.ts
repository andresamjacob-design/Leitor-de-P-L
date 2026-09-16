/**
 * Bridges the parties named in the spreadsheet to the counterparties named in the statement.
 *
 * The engine prefers identity over text (D40), and the statement hands identity over for
 * free: 308 of the 426 imported lines carry a `counterparty_tax_id`. What nothing carries
 * is the link between that document and a name a human recognises — the `Colaboradores`
 * sheet lists "Leticia Silveira" and the bank writes `LETICIA DE MATOS DA SILVEIRA`, and
 * neither side has ever written down a CPF.
 *
 * So this matches on names, conservatively, and treats every ambiguity as a reason not to
 * propose rather than a reason to guess:
 *
 *   - every significant token of the sheet's name must appear in the counterparty's;
 *   - a name that matches two different documents is a conflict, and is reported, not used;
 *   - a document that matches two different sheet names is the same, in the other direction;
 *   - a name too short to be distinctive (`ORC`, `CSO`) is skipped outright.
 *
 * What survives is printed with the evidence — how many lines, which way the money went —
 * because attaching the wrong CPF to a name is worse than attaching none.
 *
 * It **proposes**. Nothing is written unless `--aplicar` is passed, and even then it writes
 * only to `clients`, `people` and `categorization_rules`; a rule produces a suggestion and
 * never approves anything by itself.
 *
 *   npm run propose:parties              # mostra o que faria
 *   npm run propose:parties -- --aplicar # cadastra e cria as regras por documento
 */

import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { runPreview, report } from "./engine-preview.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { normalizeTaxId, formatTaxId } from "@/lib/tax-id";

loadEnvLocal();

const SPREADSHEET = "docs/reference/Claude de DRE - Dynamics Data 2026.xlsx";
const APPLY = process.argv.includes("--aplicar");
/** Do the whole write, measure it with the engine, then undo it. */
const REHEARSE = process.argv.includes("--ensaio");

type Counts = { parties: number; rules: number };

/** Thrown to undo everything the rehearsal inserted. */
class Rollback extends Error {}

const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/**
 * The scope column of the sheet is already the answer to "which revenue account": the
 * company bills continuing work and one-off projects, and the chart of accounts was
 * derived from those same two words.
 */
const SCOPE_TO_CODE: Record<string, string> = {
  Ongoing: "3.01",
  Projeto: "3.02",
};

/** Where a freelancer's payment lands. Everyone on `Colaboradores` is one — see below. */
const FREELANCER_CODE = "6.10";

/**
 * Words that carry no identity: corporate suffixes, industry nouns, prepositions. Dropped
 * only when choosing which tokens of a *sheet* name must be found — the counterparty name
 * is always searched whole, so a supplier that really is called `Brasil` still matches.
 */
const NOISE = new Set([
  "LTDA", "ME", "MEI", "EPP", "EIRELI", "SA", "CIA", "GRUPO", "THE",
  "DE", "DA", "DO", "DAS", "DOS", "E", "EM", "COM", "POR",
  "COMERCIO", "INDUSTRIA", "SERVICOS", "SERVICO", "TECNOLOGIA", "SOLUCOES",
  "CONSULTORIA", "BRASIL", "SISTEMAS", "DIGITAL", "PARTICIPACOES",
]);

type Party = {
  /** As written in the sheet, for the operator to recognise. */
  label: string;
  /** Tokens that must all be found in a counterparty's name. */
  tokens: string[];
  /** Null when the sheet is ambiguous about it — the party is still worth registering. */
  code: string | null;
  role: string | null;
  clientLabel: string | null;
};

type Counterparty = {
  name: string;
  taxId: string;
  lines: number;
  incoming: number;
  outgoing: number;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `Mary kay - B2B` and `Denise Marques (midia)` are the same client billed twice. The
 * qualifier says which contract, which this does not need — it needs who.
 */
function baseName(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, " ")
    .split(/\s+-\s+/)[0]!
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(label: string): string[] {
  return normalize(label)
    .split(" ")
    .filter((token) => token.length >= 3 && !NOISE.has(token));
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

const sheets = readXlsx(new Uint8Array(readFileSync(SPREADSHEET)));

function sheetNamed(name: string) {
  const found = sheets.find((sheet) => sheet.name === name);
  if (!found) throw new Error(`aba “${name}” não encontrada`);
  return found;
}

function readClients(): Party[] {
  const dre = sheetNamed("DRE Geral");
  const byName = new Map<string, Party>();
  const conflicting = new Set<string>();

  // The revenue block sits above the cost block; a row belongs to it when the scope column
  // says so, which is a firmer boundary than a line number.
  for (const row of dre.rows.slice(0, 90)) {
    const scope = String(row[1] ?? "").trim();
    const raw = String(row[2] ?? "").trim();
    const code = SCOPE_TO_CODE[scope];
    if (!code || raw === "") continue;

    const label = baseName(raw);
    const tokens = tokensOf(label);
    if (tokens.length === 0) continue;

    const key = tokens.join(" ");
    const existing = byName.get(key);
    if (existing) {
      // The same client billed as both ongoing and project — real, and it means the
      // revenue account cannot be decided from the sheet alone.
      if (existing.code !== code) conflicting.add(key);
      continue;
    }
    byName.set(key, { label, tokens, code, role: null, clientLabel: null });
  }

  for (const key of conflicting) {
    const party = byName.get(key);
    if (party) party.code = null;
  }

  return [...byName.values()];
}

function readPeople(): Party[] {
  const sheet = sheetNamed("Colaboradores");
  const out: Party[] = [];
  const seen = new Set<string>();

  for (const row of sheet.rows) {
    const bond = String(row[0] ?? "").trim();
    const active = String(row[1] ?? "").trim();
    const client = String(row[2] ?? "").trim();
    const name = String(row[5] ?? "").trim();
    const role = String(row[6] ?? "").trim();

    // Only the data rows carry a bond; the header repeats itself down the sheet.
    if (bond === "" || bond === "VÍNCULO" || name === "COLABORADOR") continue;
    if (active !== "" && active.toLowerCase() !== "sim") continue;

    // Three rows carry the person's surname in the *Cliente* column and leave
    // `COLABORADOR` empty — CUSTODIO, JACOB, LEONARDO. They are the three largest
    // payments in the statement, and the sheet does say `FREELANCER` about them; it just
    // says it one column to the left. Reading it is not guessing.
    const written = name === "" ? client : name;
    if (written === "") continue;

    const label = baseName(written);
    const tokens = tokensOf(label);
    if (tokens.length === 0) continue;

    const key = tokens.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label,
      tokens,
      code: FREELANCER_CODE,
      role: role === "" ? null : role,
      clientLabel: client === "" ? null : client,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Does every token of the sheet's name appear in the counterparty's?
 *
 * A token matches at a word boundary, so `SILVA` does not match `SILVEIRA`. A name whose
 * only token is short (`PDG`, `ORC`) is distinctive enough only when the counterparty's
 * *first* word starts with it — `PDG` against `PDGIT SOLUCOES` is evidence; `ORC` buried
 * somewhere in the middle of a name is coincidence.
 */
function matches(party: Party, counterparty: Counterparty): boolean {
  const haystack = normalize(counterparty.name);
  const words = haystack.split(" ");

  const found = party.tokens.every((token) => words.some((word) => word.startsWith(token)));

  // A space is not a fact about a company. The sheet writes `Enutri` and the bank writes
  // `E NUTRI PRODUTOS NUTRICIONAIS`; the sheet writes `Escola.i` and the bank writes
  // `ESCOLAI SERVICOS`. Comparing with the separators removed catches those without
  // loosening anything else — it is still a prefix match on the same distinctive token,
  // and a token long enough to be distinctive is still required below.
  const compact = party.tokens.join("");
  const glued = haystack.replace(/ /g, "");
  if (!found && !glued.startsWith(compact)) return false;

  if (party.tokens.some((token) => token.length >= 4)) return true;
  const first = words[0] ?? "";
  return party.tokens.every((token) => first.startsWith(token));
}


/**
 * Levenshtein, capped at two.
 *
 * The sheet says `Medcom` and the bank says `MEDICOM`; the sheet says `Caio Migani` and the
 * bank says `CAIO CESAR DA SILVA MIGANO`. One letter apart is usually the same party.
 */
function nearby(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let previous = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 9;
}

/**
 * How long a token must be before one letter of difference is evidence rather than
 * coincidence: six characters.
 *
 * The number is not arbitrary — it is where the real matches and the false ones separated
 * when a person read all seven candidates the report produced. `PASOLINI`, `MEDCOM` and
 * `MIGANI` are the same parties the sheet names. `SANTA` (Santa Monica × Santa Lucia),
 * `PAULO` (PM São Paulo × Paulo Carvalho), `ANCRE`/`ANDRE` (PM Santo André × Clínica
 * Ancre) and `JACOB` are not, and every one of them is five.
 */
const DISTINCTIVE = 6;

/**
 * A second attempt, for the party whose strict match found nothing.
 *
 * One token, long enough to be distinctive, matching within a letter. It only decides when
 * the pairing turns out unique in both directions — the caller enforces that — because a
 * surname that fits two companies is a surname, not an identification.
 */
function nearMatch(party: Party, counterparty: Counterparty): boolean {
  const words = normalize(counterparty.name).split(" ");
  return party.tokens.some(
    (token) =>
      token.length >= DISTINCTIVE &&
      words.some((word) => word.length >= DISTINCTIVE && nearby(word, token) <= 1),
  );
}

type Pairing = {
  party: Party;
  counterparty: Counterparty;
  kind: "cliente" | "pessoa";
  /** True when only the near match found it. A strict claim on the same document wins. */
  near: boolean;
};

function pair(parties: Party[], counterparties: Counterparty[], kind: Pairing["kind"]) {
  const found: Pairing[] = [];
  const ambiguous: { party: Party; candidates: Counterparty[] }[] = [];

  for (const party of parties) {
    // The strict match first. Only when it finds nothing does the near match get a turn,
    // so a party that already has a clean pairing is never re-decided by a fuzzier rule.
    const strict = counterparties.filter((counterparty) => matches(party, counterparty));
    const near = strict.length > 0 ? [] : counterparties.filter((c) => nearMatch(party, c));
    const candidates = strict.length > 0 ? strict : near;
    if (candidates.length === 0) continue;

    // One party legitimately holds two documents: a freelancer invoices as a person one
    // month and through their MEI the next, and both are the same human being. That is
    // safe to accept only when the name itself is strong evidence — two matched tokens.
    // A single-token name landing on two documents is a coincidence until proven otherwise.
    if (candidates.length > 1 && party.tokens.length < 2) {
      ambiguous.push({ party, candidates });
      continue;
    }

    for (const counterparty of candidates) {
      found.push({ party, counterparty, kind, near: strict.length === 0 });
    }
  }

  return { found, ambiguous };
}

// ---------------------------------------------------------------------------
// Report and write
// ---------------------------------------------------------------------------

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

function mask(taxId: string): string {
  const formatted = formatTaxId(taxId);
  return `${"•".repeat(Math.max(formatted.length - 6, 0))}${formatted.slice(-6)}`;
}

try {
  const entities = await sql<{ id: string }[]>`
    select id from entities where slug = 'dd-group'`;
  const entity = entities[0];
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");
  // Bound out here so the narrowing survives into `write`, which is called later.
  const entityId = entity.id;

  const categories = await sql<{ id: string; code: string; name: string }[]>`
    select id, code, name from categories where entity_id = ${entity.id}`;
  const byCode = new Map(categories.map((category) => [category.code, category]));

  // Where a counterparty is allowed to come from: the ledger first, staging only for what
  // has not reached it.
  //
  // Reading `staged_transactions` alone was the same blind spot D88 records about the
  // engine, one table over. Staging is what an import *proposes*; the ledger is what the
  // company actually paid, and the two stopped agreeing the moment a script wrote straight
  // to the ledger. `import:sispag` (D96) does exactly that — it replaces a batch line with
  // the payments inside it — so its 116 payments and their documents never passed through
  // staging, and thirteen counterparties were invisible here while sitting in plain sight
  // in `pendencias`.
  //
  // The damage was not only the silence. A collaborator whose real document is missing from
  // the universe finds no strict match, falls through to the approximate rule, and gets
  // claimed by whatever surname is one letter away: `Vitor Oliveira`, `Anna Flavia de
  // Oliveira` and `Jonailson Junior` all landed on `ROBERTO PASCOAL DE OLIVEIRA JUNIOR`
  // and were reported as a three-way dispute that never existed. Absent evidence does not
  // read as absent — it reads as a wrong answer held confidently, which is the D96 lesson
  // again.
  //
  // `status = 'pending'` is what keeps the counts honest, and it says the thing exactly: an
  // *approved* staged row already **is** a `cash_entries` row, so counting both would double
  // every piece of evidence printed below, and a `duplicate` or `rejected` row was never
  // money to begin with. Today that reads 1.064 ledger lines plus nothing pending.
  //
  // Grouped by document, never by name: the same company arrives spelled two ways —
  // `PDGIT SOLUCOES EM TECNOLOGIA LTDA` and `PDGIT SOLUCOES` are one CNPJ — and counting
  // them apart both undercounts the lines and invents an ambiguity that is not there.
  // The longest spelling wins as the label, being the one that carries the most evidence.
  const counterparties = await sql<Counterparty[]>`
    with linhas as (
      -- The two tables do not agree on what a sign means, and the disagreement is silent.
      -- staged_transactions.amount is signed, the way the statement prints it;
      -- cash_entries.amount is a magnitude and the way the money went lives in direction.
      -- Reading the ledger amount as if it were signed makes every row an entrada -- the
      -- first run of this query turned CUSTODIO's 15 payments into 26 receipts and raised
      -- "sentido invertido" on the whole payroll. Direction is the one fact D82 and D86
      -- exist to protect, so it is restored here rather than assumed.
      select
        counterparty_name,
        counterparty_tax_id,
        case when direction = 'out' then -amount else amount end as amount
      from cash_entries
      where entity_id = ${entity.id}
        and counterparty_tax_id is not null
        and counterparty_name is not null
      union all
      select counterparty_name, counterparty_tax_id, amount
      from staged_transactions
      where entity_id = ${entity.id}
        and status = 'pending'
        and counterparty_tax_id is not null
        and counterparty_name is not null
    )
    select
      (array_agg(counterparty_name order by length(counterparty_name) desc))[1] as name,
      regexp_replace(counterparty_tax_id, '\\D', '', 'g') as "taxId",
      count(*)::int                                      as lines,
      count(*) filter (where amount > 0)::int            as incoming,
      count(*) filter (where amount < 0)::int            as outgoing
    from linhas
    group by 2
    order by 3 desc`;

  const clients = readClients();
  const people = readPeople();

  console.log(
    `\n${BOLD}${clients.length} clientes e ${people.length} colaboradores na planilha, ` +
      `contra ${counterparties.length} contrapartes identificadas no extrato${RESET}\n`,
  );

  const clientPairs = pair(clients, counterparties, "cliente");
  const peoplePairs = pair(people, counterparties, "pessoa");

  // A document claimed by both a client and a collaborator is the interesting failure:
  // it means the same party is on both sides of the books, which is exactly the case
  // rule direction exists for. Neither side gets a rule until a human says which.
  const claims = new Map<string, Pairing[]>();
  for (const pairing of [...clientPairs.found, ...peoplePairs.found]) {
    const list = claims.get(pairing.counterparty.taxId) ?? [];
    list.push(pairing);
    claims.set(pairing.counterparty.taxId, list);
  }

  // A counterparty that *is* another entity of this group is not a supplier and not a
  // freelancer — it is the company next door, and money between them is a transfer (D-C).
  //
  // Compared by document, never by name, and the reason is the whole point of D40: the
  // entity `Gabriel Sampaio Jacob LTDA - ME` has a CNPJ, and the person Gabriel Sampaio
  // Jacob has a CPF. They share a name and are not the same party — he is paid on the same
  // day, in the same batch, as the other two partners. A name guard held those seven lines
  // out of payroll for no reason.
  const others = await sql<{ taxId: string | null }[]>`
    select regexp_replace(tax_id, '\\D', '', 'g') as "taxId"
    from entities where id <> ${entityId}`;
  const otherDocuments = new Set(others.map((row) => row.taxId).filter((doc): doc is string => !!doc));

  const clean: Pairing[] = [];
  const disputed: Pairing[][] = [];
  const intercompany: Pairing[] = [];
  for (const raw of claims.values()) {
    // A document claimed both strictly and approximately is not in dispute: the strict
    // claim wins and the approximate one was a coincidence. `VICTORIA DE LACERDA` is
    // Victoria Lacerda, however much `Liga Vitoria` looks like it from one letter away.
    const strict = raw.filter((pairing) => !pairing.near);
    const list = strict.length > 0 ? strict : raw;
    if (list.length !== 1) {
      disputed.push(list);
      continue;
    }
    const pairing = list[0]!;
    if (otherDocuments.has(pairing.counterparty.taxId)) {
      intercompany.push(pairing);
      continue;
    }
    clean.push(pairing);
  }

  /**
   * A client that only ever received money, or a collaborator that only ever sent it, is
   * the shape of a wrong match. It does not disqualify the pairing — a client really can
   * be refunded — but it is the first thing worth a human's eye.
   */
  function backwards(pairing: Pairing): boolean {
    const { counterparty, kind } = pairing;
    return kind === "cliente" ? counterparty.incoming === 0 : counterparty.outgoing === 0;
  }

  function show(pairing: Pairing): void {
    const { party, counterparty, kind } = pairing;
    const category = party.code ? byCode.get(party.code) : undefined;
    const flow = `${counterparty.incoming}e/${counterparty.outgoing}s`;
    const target = category ? `${party.code} ${category.name}` : `${YELLOW}sem conta definida${RESET}`;
    const alert = backwards(pairing) ? `${RED} ⚠ sentido invertido${RESET}` : "";
    console.log(
      `  ${GREEN}${String(counterparty.lines).padStart(3)}${RESET} ${kind === "cliente" ? "🏢" : "👤"} ` +
        `${party.label.padEnd(24).slice(0, 24)} ${DIM}→${RESET} ` +
        `${counterparty.name.padEnd(38).slice(0, 38)} ${DIM}${mask(counterparty.taxId)} ${flow}${RESET}  ${target}${alert}`,
    );
  }

  const covered = clean.reduce((total, pairing) => total + pairing.counterparty.lines, 0);
  console.log(`${BOLD}casamentos únicos — ${clean.length} partes, ${covered} linhas${RESET}`);
  for (const pairing of [...clean].sort((a, b) => b.counterparty.lines - a.counterparty.lines)) {
    show(pairing);
  }

  if (intercompany.length > 0) {
    console.log(`\n${BOLD}${YELLOW}deixados de fora — o nome é de outra entidade do grupo${RESET}`);
    for (const pairing of intercompany) {
      console.log(
        `  ${String(pairing.counterparty.lines).padStart(3)}  ${pairing.counterparty.name} ` +
          `${DIM}${mask(pairing.counterparty.taxId)} — provável transferência entre empresas (Q2), não ${pairing.kind}${RESET}`,
      );
    }
  }

  if (disputed.length > 0) {
    console.log(`\n${BOLD}${RED}disputados — o mesmo documento casa com dois nomes${RESET}`);
    for (const list of disputed) {
      const first = list[0]!;
      console.log(
        `  ${String(first.counterparty.lines).padStart(3)}  ${first.counterparty.name} ${DIM}${mask(first.counterparty.taxId)}${RESET}`,
      );
      for (const pairing of list) console.log(`         ${DIM}↳ ${pairing.kind}: ${pairing.party.label}${RESET}`);
    }
  }

  const allAmbiguous = [...clientPairs.ambiguous, ...peoplePairs.ambiguous];
  if (allAmbiguous.length > 0) {
    console.log(`\n${BOLD}${YELLOW}ambíguos — um nome da planilha casa com vários documentos${RESET}`);
    for (const { party, candidates } of allAmbiguous) {
      console.log(`  ${party.label}`);
      for (const candidate of candidates) {
        console.log(`         ${DIM}↳ ${candidate.name} ${mask(candidate.taxId)} (${candidate.lines} linhas)${RESET}`);
      }
    }
  }

  const matched = new Set(clean.map((pairing) => pairing.counterparty.taxId));
  for (const list of disputed) for (const pairing of list) matched.add(pairing.counterparty.taxId);
  const orphans = counterparties.filter((counterparty) => !matched.has(counterparty.taxId));
  const orphanLines = orphans.reduce((total, counterparty) => total + counterparty.lines, 0);

  console.log(
    `\n${BOLD}sem correspondência na planilha — ${orphans.length} contrapartes, ${orphanLines} linhas${RESET}`,
  );
  for (const counterparty of orphans.slice(0, 20)) {
    console.log(
      `  ${String(counterparty.lines).padStart(3)}  ${counterparty.name.padEnd(38).slice(0, 38)} ` +
        `${DIM}${mask(counterparty.taxId)}  ${counterparty.incoming}e/${counterparty.outgoing}s${RESET}`,
    );
  }
  if (orphans.length > 20) console.log(`  ${DIM}… e mais ${orphans.length - 20}${RESET}`);

  // Orphans that look like somebody on the sheet, close enough to be worth a human's eye
  // and never close enough for this script to act on.
  const usedParties = new Set(clean.map((pairing) => pairing.party.label));
  const spare = [...clients, ...people].filter((party) => !usedParties.has(party.label));
  const review: { counterparty: Counterparty; party: Party; why: string }[] = [];

  for (const counterparty of orphans) {
    const words = normalize(counterparty.name).split(" ").filter((word) => word.length >= 5);
    for (const party of spare) {
      for (const token of party.tokens.filter((item) => item.length >= 5)) {
        const exact = words.find((word) => word === token || word.startsWith(token));
        if (exact) {
          review.push({ counterparty, party, why: `“${token}” aparece no nome` });
          break;
        }
        const close = words.find((word) => nearby(word, token) === 1);
        if (close) {
          review.push({ counterparty, party, why: `“${token}” × “${close}” — uma letra` });
          break;
        }
      }
      if (review.some((item) => item.counterparty.taxId === counterparty.taxId)) break;
    }
  }

  if (review.length > 0) {
    console.log(`\n${BOLD}${YELLOW}conferir — parecem estar na planilha, mas não o bastante para decidir${RESET}`);
    for (const item of review) {
      console.log(
        `  ${String(item.counterparty.lines).padStart(3)}  ${item.counterparty.name.slice(0, 38).padEnd(38)} ` +
          `${DIM}→${RESET} ${item.party.label.padEnd(20).slice(0, 20)} ${DIM}${item.why}${RESET}`,
      );
    }
  }

  const withCode = clean.filter((pairing) => pairing.party.code !== null);
  const ruleLines = withCode.reduce((total, pairing) => total + pairing.counterparty.lines, 0);
  console.log(
    `\n${BOLD}${withCode.length} regras por documento seriam criadas, alcançando ${ruleLines} linhas.${RESET}`,
  );

  /**
   * Registers each matched party and gives it a rule keyed on its document.
   *
   * Takes the handle rather than closing over the connection, so the rehearsal can hand it
   * an open transaction and throw the whole thing away afterwards.
   */
  async function write(db: Sql): Promise<Counts> {
    let parties = 0;
    let rules = 0;

    for (const pairing of clean) {
      const { party, counterparty, kind } = pairing;
      const taxId = normalizeTaxId(counterparty.taxId);

      let partyId: string | null = null;
      if (kind === "cliente") {
        const existing = await db<{ id: string }[]>`
          select id from clients
          where entity_id = ${entityId} and regexp_replace(tax_id, '\\D', '', 'g') = ${taxId}
          limit 1`;
        if (existing[0]) partyId = existing[0].id;
        else {
          const inserted = await db<{ id: string }[]>`
            insert into clients (entity_id, name, tax_id)
            values (${entityId}, ${party.label}, ${taxId})
            returning id`;
          partyId = inserted[0]?.id ?? null;
          parties += 1;
        }
      } else {
        const existing = await db<{ id: string }[]>`
          select id from people
          where entity_id = ${entityId} and regexp_replace(tax_id, '\\D', '', 'g') = ${taxId}
          limit 1`;
        if (existing[0]) partyId = existing[0].id;
        else {
          const inserted = await db<{ id: string }[]>`
            insert into people (entity_id, name, role, kind, bond, tax_id)
            values (${entityId}, ${party.label}, ${party.role}, 'contractor', 'freelancer', ${taxId})
            returning id`;
          partyId = inserted[0]?.id ?? null;
          parties += 1;
        }
      }

      if (!party.code || !partyId) continue;
      const category = byCode.get(party.code);
      if (!category) continue;

      const exists = await db`
        select 1 from categorization_rules
        where entity_id = ${entityId}
          and regexp_replace(counterparty_tax_id, '\\D', '', 'g') = ${taxId}
        limit 1`;
      if (exists.length > 0) continue;

      // Priority 10: ahead of every text rule, which is the whole point of D40. The
      // pattern `*` means "this counterparty, whatever the description says".
      await db`
        insert into categorization_rules
          (entity_id, priority, match_type, pattern, counterparty_tax_id, direction,
           category_id, client_id, person_id, active)
        values (${entityId}, 10, 'contains', '*', ${taxId},
                ${kind === "cliente" ? "in" : "out"}, ${category.id},
                ${kind === "cliente" ? partyId : null}, ${kind === "pessoa" ? partyId : null},
                true)`;
      rules += 1;
    }

    return { parties, rules };
  }

  if (!APPLY && !REHEARSE) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --ensaio para ver a cobertura resultante ` +
        `numa transação revertida, ou --aplicar para gravar.${RESET}\n`,
    );
  } else {
    const written = await (REHEARSE
      ? sql
          .begin(async (tx) => {
            const counts = await write(tx as unknown as Sql);
            const names = new Map(categories.map((category) => [category.id, category]));
            report(await runPreview(tx as unknown as Sql, entity.id), names);
            // Everything above happened; nothing above survives. The numbers are real and
            // the database is not touched, which is the only way to answer "what would I
            // get" before agreeing to find out.
            throw new Rollback(JSON.stringify(counts));
          })
          .catch((error: unknown) => {
            if (error instanceof Rollback) return JSON.parse(error.message) as Counts;
            throw error;
          })
      : write(sql));

    console.log(
      `\n${GREEN}${written.parties} partes ${REHEARSE ? "seriam cadastradas" : "cadastradas"} ` +
        `e ${written.rules} regras por documento ${REHEARSE ? "seriam criadas" : "criadas"}.${RESET}`,
    );
    if (REHEARSE) console.log(`${DIM}ensaio: a transação foi revertida, nada foi gravado.${RESET}\n`);
    else console.log("");
  }
} finally {
  await sql.end();
}
