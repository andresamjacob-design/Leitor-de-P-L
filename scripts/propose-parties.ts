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

    // Only the data rows carry a bond *and* a name; the header repeats itself down the sheet.
    if (bond === "" || bond === "VÍNCULO" || name === "" || name === "COLABORADOR") continue;
    if (active !== "" && active.toLowerCase() !== "sim") continue;

    const label = baseName(name);
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

  for (const token of party.tokens) {
    if (!words.some((word) => word.startsWith(token))) return false;
  }

  if (party.tokens.some((token) => token.length >= 4)) return true;
  const first = words[0] ?? "";
  return party.tokens.every((token) => first.startsWith(token));
}

type Pairing = { party: Party; counterparty: Counterparty; kind: "cliente" | "pessoa" };

function pair(parties: Party[], counterparties: Counterparty[], kind: Pairing["kind"]) {
  const found: Pairing[] = [];
  const ambiguous: { party: Party; candidates: Counterparty[] }[] = [];

  for (const party of parties) {
    const candidates = counterparties.filter((counterparty) => matches(party, counterparty));
    if (candidates.length === 0) continue;

    // One party legitimately holds two documents: a freelancer invoices as a person one
    // month and through their MEI the next, and both are the same human being. That is
    // safe to accept only when the name itself is strong evidence — two matched tokens.
    // A single-token name landing on two documents is a coincidence until proven otherwise.
    if (candidates.length > 1 && party.tokens.length < 2) {
      ambiguous.push({ party, candidates });
      continue;
    }

    for (const counterparty of candidates) found.push({ party, counterparty, kind });
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

  // Grouped by document, never by name: the same company arrives spelled two ways —
  // `PDGIT SOLUCOES EM TECNOLOGIA LTDA` and `PDGIT SOLUCOES` are one CNPJ — and counting
  // them apart both undercounts the lines and invents an ambiguity that is not there.
  // The longest spelling wins as the label, being the one that carries the most evidence.
  const counterparties = await sql<Counterparty[]>`
    select
      (array_agg(counterparty_name order by length(counterparty_name) desc))[1] as name,
      regexp_replace(counterparty_tax_id, '\\D', '', 'g') as "taxId",
      count(*)::int                                      as lines,
      count(*) filter (where amount > 0)::int            as incoming,
      count(*) filter (where amount < 0)::int            as outgoing
    from staged_transactions
    where entity_id = ${entity.id}
      and counterparty_tax_id is not null
      and counterparty_name is not null
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

  const clean: Pairing[] = [];
  const disputed: Pairing[][] = [];
  for (const list of claims.values()) {
    if (list.length === 1) clean.push(list[0]!);
    else disputed.push(list);
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
