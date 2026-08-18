/**
 * The categorisation engine. Pure, deterministic, and explainable.
 *
 * The order below is the whole design, and it is not the order the PLAN first sketched —
 * see DECISIONS D40. Two principles decide it:
 *
 *   **Identity beats text.** The Itaú statement carries the counterparty's CNPJ. That
 *   says *who* paid or was paid; a description says what a string happens to look like.
 *   `SALESFORCE` appears in this company's books as both a client and a supplier, so
 *   matching by name would put revenue and cost in the same bucket.
 *
 *   **Explicit beats learned.** A rule is how a person corrects a mistake. If history
 *   outranked rules, one miscategorised entry would repeat itself forever and the only
 *   fix would be to hunt down the original.
 *
 * So: a rule keyed on the CNPJ, then a rule on text or amount, then what was done last
 * time with that CNPJ, then with that description, and finally a person's name.
 */

import type { Cents } from "@/lib/money";
import { abs } from "@/lib/money";
import { normalizeDescription } from "@/lib/dedup";
import { normalizeTaxId } from "@/lib/tax-id";
import type {
  HistoryEntry,
  Person,
  Rule,
  Subject,
  Suggestion,
  SuggestionSource,
} from "@/lib/categorize/types";

/** How much to trust each route. The review screen pre-selects at 0,8 and above. */
const CONFIDENCE: Record<SuggestionSource, number> = {
  rule_tax_id: 1,
  rule_text: 0.95,
  history_tax_id: 0.9,
  history_description: 0.85,
  person: 0.7,
};

export type EngineInput = {
  rules: readonly Rule[];
  history: readonly HistoryEntry[];
  people: readonly Person[];
  /** Where a salary lands when a person's name is recognised but nothing else is known. */
  payrollCategoryId?: string | null;
  /**
   * As contas de custo, despesa e imposto — as que o espelho de competência assina pelo
   * sentido (`planCashMirror`).
   *
   * Serve a uma única regra, a D83: **o histórico não pode pôr uma entrada numa conta de
   * custo.** O histórico aprende com o que já aconteceu e não sabe nada sobre sentido; foi
   * ele que arquivou os recebimentos de Hold Beauty e Ciclo na 8.03 Agência — a despesa que
   * a empresa paga *a eles* — e as devoluções do Ricardo na 6.10, criando R$ 218.800 de
   * custo negativo fantasma.
   *
   * Uma regra explícita continua podendo fazer isso, e deve: ela tem `direction` para dizer
   * que quis (migration `0004`), e um estorno de cartão em 7.02 é exatamente esse caso. O
   * histórico não tem como declarar intenção, então não recebe o benefício da dúvida.
   *
   * Opcional para não quebrar quem chama sem ela; sem o conjunto, nada é bloqueado.
   */
  costCategoryIds?: ReadonlySet<string>;
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function withinAmount(rule: Rule, amount: Cents): boolean {
  const magnitude = abs(amount);
  if (rule.amountMin !== null && magnitude < rule.amountMin) return false;
  if (rule.amountMax !== null && magnitude > rule.amountMax) return false;
  return true;
}

/**
 * Does the rule's pattern match? A bad regex is the rule's problem, not the import's —
 * it fails to match and says so, rather than breaking the whole batch.
 */
function matchesPattern(rule: Rule, subject: Subject): boolean {
  const description = normalizeDescription(subject.description);
  const pattern = normalizeDescription(rule.pattern);

  switch (rule.matchType) {
    case "contains":
      return pattern !== "" && description.includes(pattern);
    case "exact":
      return description === pattern;
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(subject.description);
      } catch {
        return false;
      }
    case "amount_range":
      // The amount is checked separately; the range alone is the whole condition.
      return rule.amountMin !== null || rule.amountMax !== null;
    default:
      return false;
  }
}

function applies(rule: Rule, subject: Subject): boolean {
  if (!rule.active) return false;
  if (rule.direction !== null && rule.direction !== subject.direction) return false;
  if (rule.accountId !== null && rule.accountId !== subject.accountId) return false;
  if (!withinAmount(rule, subject.amount)) return false;

  if (rule.counterpartyTaxId !== null) {
    const wanted = normalizeTaxId(rule.counterpartyTaxId);
    const found = subject.counterpartyTaxId ? normalizeTaxId(subject.counterpartyTaxId) : "";
    if (wanted === "" || wanted !== found) return false;
    // A CNPJ rule with no textual pattern matches on identity alone.
    if (rule.pattern.trim() === "" || rule.pattern.trim() === "*") return true;
  }

  return matchesPattern(rule, subject);
}

/** Lowest `priority` first, then oldest-defined, so the outcome never depends on load order. */
function byPriority(a: Rule, b: Rule): number {
  return a.priority - b.priority || a.id.localeCompare(b.id);
}

export function matchRules(rules: readonly Rule[], subject: Subject): Rule[] {
  return [...rules].filter((rule) => applies(rule, subject)).sort(byPriority);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * A person is recognised only when at least two parts of their name appear in the
 * description. One token would match half the country on `SILVA`, and a payroll line
 * attributed to the wrong person is worse than no attribution at all.
 */
export function matchPerson(people: readonly Person[], description: string): Person | null {
  const text = normalizeDescription(description);
  let best: { person: Person; score: number } | null = null;

  for (const person of people) {
    const parts = normalizeDescription(person.name)
      .split(" ")
      .filter((part) => part.length >= 3);
    if (parts.length < 2) continue;

    const found = parts.filter((part) => text.includes(part));
    if (found.length < 2) continue;

    // More matched name parts wins, so `Ana Paula Ribeiro` beats `Ana Paula` on a line
    // that names all three. The ratio only breaks ties.
    const score = found.length + found.length / parts.length;
    if (!best || score > best.score) best = { person, score };
  }

  return best?.person ?? null;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

type HistoryIndex = {
  byTaxId: Map<string, HistoryEntry>;
  byDescription: Map<string, HistoryEntry>;
};

/** The most recent categorisation wins: it is the one the person last agreed with. */
export function indexHistory(history: readonly HistoryEntry[]): HistoryIndex {
  const byTaxId = new Map<string, HistoryEntry>();
  const byDescription = new Map<string, HistoryEntry>();

  for (const entry of history) {
    if (entry.counterpartyTaxId) {
      const key = normalizeTaxId(entry.counterpartyTaxId);
      const current = byTaxId.get(key);
      if (!current || entry.occurredOn >= current.occurredOn) byTaxId.set(key, entry);
    }

    const description = normalizeDescription(entry.description);
    if (description !== "") {
      const current = byDescription.get(description);
      if (!current || entry.occurredOn >= current.occurredOn) {
        byDescription.set(description, entry);
      }
    }
  }

  return { byTaxId, byDescription };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * O histórico pode mandar esta entrada para esta conta?
 *
 * Não, quando a entrada cairia numa conta de custo (D83). Ver `costCategoryIds`.
 */
function learnedSuggestionIsAllowed(
  subject: Subject,
  categoryId: string,
  costCategoryIds: ReadonlySet<string> | undefined,
): boolean {
  if (!costCategoryIds) return true;
  if (subject.direction !== "in") return true;
  return !costCategoryIds.has(categoryId);
}

export function suggestCategory(
  subject: Subject,
  { rules, history, people, payrollCategoryId = null, costCategoryIds }: EngineInput,
): Suggestion | null {
  const matches = matchRules(rules, subject);

  // 1. A rule keyed on the counterparty. Nothing is more specific than "this CNPJ".
  const taxIdRule = matches.find((rule) => rule.counterpartyTaxId !== null);
  if (taxIdRule) {
    return {
      categoryId: taxIdRule.categoryId,
      clientId: taxIdRule.clientId,
      personId: taxIdRule.personId,
      source: "rule_tax_id",
      confidence: CONFIDENCE.rule_tax_id,
      reason: `regra por CNPJ ${taxIdRule.counterpartyTaxId}`,
      ruleId: taxIdRule.id,
    };
  }

  // 2. A rule on text or amount.
  const textRule = matches[0];
  if (textRule) {
    return {
      categoryId: textRule.categoryId,
      clientId: textRule.clientId,
      personId: textRule.personId,
      source: "rule_text",
      confidence: CONFIDENCE.rule_text,
      reason:
        textRule.matchType === "amount_range"
          ? "regra por faixa de valor"
          : `regra “${textRule.pattern}”`,
      ruleId: textRule.id,
    };
  }

  const index = indexHistory(history);

  // 3. The same counterparty, categorised before.
  if (subject.counterpartyTaxId) {
    const previous = index.byTaxId.get(normalizeTaxId(subject.counterpartyTaxId));
    if (previous && learnedSuggestionIsAllowed(subject, previous.categoryId, costCategoryIds)) {
      return {
        categoryId: previous.categoryId,
        clientId: previous.clientId,
        personId: previous.personId,
        source: "history_tax_id",
        confidence: CONFIDENCE.history_tax_id,
        reason: `mesmo CNPJ de “${previous.description}”`,
        ruleId: null,
      };
    }
  }

  // 4. The same description, categorised before.
  const seen = index.byDescription.get(normalizeDescription(subject.description));
  if (seen && learnedSuggestionIsAllowed(subject, seen.categoryId, costCategoryIds)) {
    return {
      categoryId: seen.categoryId,
      clientId: seen.clientId,
      personId: seen.personId,
      source: "history_description",
      confidence: CONFIDENCE.history_description,
      reason: "mesma descrição já categorizada antes",
      ruleId: null,
    };
  }

  // 5. A person's name in the description — payroll, most likely.
  const person = matchPerson(people, subject.description);
  if (person && payrollCategoryId) {
    return {
      categoryId: payrollCategoryId,
      clientId: null,
      personId: person.id,
      source: "person",
      confidence: CONFIDENCE.person,
      reason: `o nome de ${person.name} aparece na descrição`,
      ruleId: null,
    };
  }

  return null;
}

/** Suggestions for a batch, keyed by whatever id the caller uses. */
export function suggestMany<T extends { id: string } & Subject>(
  subjects: readonly T[],
  input: EngineInput,
): Map<string, Suggestion> {
  const out = new Map<string, Suggestion>();
  for (const subject of subjects) {
    const suggestion = suggestCategory(subject, input);
    if (suggestion) out.set(subject.id, suggestion);
  }
  return out;
}

/**
 * A rule proposed from a movement the user just categorised by hand.
 *
 * The pattern is the description with the parts that never repeat stripped out — dates,
 * long digit runs, instalment counters. `Uber UBER *TRIP HELP.U` stays; `PIX RECEBIDO
 * CICLO -06/01` becomes `PIX RECEBIDO CICLO`.
 */
export function proposeRuleFrom(subject: Subject): {
  matchType: "contains" | "exact";
  pattern: string;
  counterpartyTaxId: string | null;
} {
  const stripped = normalizeDescription(subject.description)
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[-*]+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // With a CNPJ, the text is redundant and only narrows the rule for no reason: the same
  // supplier writes its name a dozen ways. `*` means "this counterparty, whatever the
  // description says".
  if (subject.counterpartyTaxId) {
    return {
      matchType: "contains",
      pattern: "*",
      counterpartyTaxId: normalizeTaxId(subject.counterpartyTaxId),
    };
  }

  return {
    matchType: "contains",
    pattern: stripped === "" ? normalizeDescription(subject.description) : stripped,
    counterpartyTaxId: null,
  };
}
