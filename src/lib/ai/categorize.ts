/**
 * Layer 3 of categorisation: one batched LLM call for what the deterministic layers could
 * not decide (SPEC §8).
 *
 * The prompt and the validation are pure functions, so the interesting half — what happens
 * when the model returns something wrong — is tested without a network call.
 *
 * Two hard constraints, both enforced here rather than trusted:
 *
 *   **No amounts.** The model sees a description and a counterparty name. It never sees a
 *   value, and it never returns one. Amounts come from the parser (SPEC §8).
 *
 *   **Every id is checked.** A category code, a client or a person that does not resolve
 *   against this entity's own data is dropped. A model that invents a plausible-looking
 *   code gets nothing for it.
 */

import { extractJson } from "@/lib/ai/provider";

export type AiSubject = {
  /** Our row id. Sent so the reply can be mapped back; never interpreted by the model. */
  ref: string;
  description: string;
  counterpartyName: string | null;
  /** `out` or `in` — direction is not an amount, and it changes what a text means. */
  direction: "in" | "out";
};

export type AiCatalogue = {
  categories: { id: string; code: string; name: string; kind: string }[];
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
};

export type AiSuggestion = {
  ref: string;
  categoryId: string;
  categoryCode: string;
  clientId: string | null;
  personId: string | null;
  confidence: number;
  reasoning: string;
};

export type AiDiscard = {
  ref: string | null;
  reason: string;
};

export type AiCategorization = {
  suggestions: AiSuggestion[];
  discarded: AiDiscard[];
  /**
   * Os `ref` que foram perguntados e sobre os quais a IA não disse nada (D127).
   *
   * Campo próprio, e não mais um `discarded`, porque **omitir não é erro** — o teste que
   * afirma isso é anterior a este campo e continua valendo. Descarte é "a IA respondeu e
   * nós recusamos"; isto é "a IA não respondeu". Misturar os dois faria a tela mostrar
   * como defeito o que é o modelo se recusando a chutar, que é o comportamento certo.
   */
  unanswered: string[];
};

export const SYSTEM_PROMPT = `Você classifica lançamentos financeiros de uma consultoria brasileira.

Recebe uma lista de descrições de extrato bancário e de fatura de cartão, e devolve, para
cada uma, a conta do plano de contas que melhor a descreve.

Regras:
- Responda SOMENTE com um array JSON, sem texto antes ou depois.
- Use exatamente os códigos de conta fornecidos. Não invente código.
- "client_id" e "person_id" são opcionais; use apenas os ids fornecidos, ou null.
- "confidence" é um número de 0 a 1. Seja honesto: use valores baixos quando a descrição
  for ambígua. É melhor uma confiança baixa do que um palpite disfarçado de certeza.
- "reasoning" é uma frase curta em português explicando a escolha.
- Se não souber classificar, não inclua a linha na resposta. Omitir é melhor que chutar.

Formato de cada item:
{"ref":"...","category_code":"...","client_id":null,"person_id":null,"confidence":0.9,"reasoning":"..."}`;

/**
 * `output_config.format` — o schema é o que garante o array sem prosa em volta, agora que
 * o prefill de `[` não existe mais. `client_id`/`person_id` entram em `required` porque
 * `additionalProperties: false` exige todas as chaves; a opcionalidade continua sendo
 * `null`, do jeito que o `SYSTEM_PROMPT` já pedia.
 */
export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "array",
  items: {
    type: "object",
    properties: {
      ref: { type: "string" },
      category_code: { type: "string" },
      client_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      person_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      confidence: { type: "number" },
      reasoning: { type: "string" },
    },
    required: ["ref", "category_code", "client_id", "person_id", "confidence", "reasoning"],
    additionalProperties: false,
  },
};

/** The prompt. Amounts are deliberately absent — see the module header. */
export function buildCategorizationPrompt(
  subjects: readonly AiSubject[],
  catalogue: AiCatalogue,
): string {
  const categories = catalogue.categories
    .map((category) => `${category.code} — ${category.name} (${category.kind})`)
    .join("\n");

  const clients =
    catalogue.clients.length > 0
      ? catalogue.clients.map((client) => `${client.id} — ${client.name}`).join("\n")
      : "(nenhum cliente cadastrado)";

  const people =
    catalogue.people.length > 0
      ? catalogue.people.map((person) => `${person.id} — ${person.name}`).join("\n")
      : "(nenhuma pessoa cadastrada)";

  const lines = subjects
    .map((subject) => {
      const counterparty = subject.counterpartyName ? ` | contraparte: ${subject.counterpartyName}` : "";
      const direction = subject.direction === "in" ? "entrada" : "saída";
      return `${subject.ref} | ${direction} | ${subject.description}${counterparty}`;
    })
    .join("\n");

  return `PLANO DE CONTAS
${categories}

CLIENTES
${clients}

PESSOAS
${people}

LANÇAMENTOS A CLASSIFICAR
${lines}`;
}

type RawItem = {
  ref?: unknown;
  category_code?: unknown;
  client_id?: unknown;
  person_id?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Turns a reply into suggestions, dropping everything that does not check out.
 *
 * Nothing here trusts the model: a ref that was not asked about, a code that is not in
 * this entity's chart, a client id from somewhere else, a confidence that is not a number
 * between 0 and 1 — each one is discarded with a reason the screen can show. Silently
 * fixing a bad value would be the worst of the options, because it would look right.
 */
export function parseCategorization(
  text: string,
  subjects: readonly AiSubject[],
  catalogue: AiCatalogue,
): AiCategorization {
  const suggestions: AiSuggestion[] = [];
  const discarded: AiDiscard[] = [];

  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (cause) {
    return {
      suggestions: [],
      discarded: [{ ref: null, reason: cause instanceof Error ? cause.message : "resposta ilegível" }],
      unanswered: subjects.map((subject) => subject.ref),
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      suggestions: [],
      discarded: [{ ref: null, reason: "a resposta não é uma lista." }],
      unanswered: subjects.map((subject) => subject.ref),
    };
  }

  const askedFor = new Set(subjects.map((subject) => subject.ref));
  const byCode = new Map(catalogue.categories.map((category) => [category.code, category]));
  const clientIds = new Set(catalogue.clients.map((client) => client.id));
  const personIds = new Set(catalogue.people.map((person) => person.id));
  const seen = new Set<string>();
  /**
   * Todo `ref` que apareceu na resposta, tenha ele virado sugestão ou não. É diferente de
   * `seen`, que só guarda os que passaram: sem essa distinção, uma linha respondida e
   * recusada (conta inexistente, confiança fora de faixa) seria acusada no fim de "não
   * respondida", que é falso e manda o leitor procurar no lugar errado.
   */
  const answered = new Set<string>();

  for (const item of parsed as RawItem[]) {
    const ref = asString(item?.ref);
    if (ref === null) {
      discarded.push({ ref: null, reason: "item sem “ref”." });
      continue;
    }
    if (!askedFor.has(ref)) {
      discarded.push({ ref, reason: "a IA respondeu sobre um lançamento que não foi perguntado." });
      continue;
    }
    answered.add(ref);
    if (seen.has(ref)) {
      discarded.push({ ref, reason: "a IA respondeu duas vezes sobre o mesmo lançamento." });
      continue;
    }

    const code = asString(item?.category_code);
    const category = code === null ? undefined : byCode.get(code);
    if (!category) {
      discarded.push({
        ref,
        reason: code === null ? "item sem código de conta." : `a conta “${code}” não existe.`,
      });
      continue;
    }

    const rawConfidence = item?.confidence;
    const confidence = typeof rawConfidence === "number" ? rawConfidence : Number.NaN;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      discarded.push({ ref, reason: "a confiança não é um número entre 0 e 1." });
      continue;
    }

    // A bad client or person loses only that field, not the whole suggestion — the
    // category is still useful, and dropping it would cost more than it saves.
    const rawClient = asString(item?.client_id);
    const clientId = rawClient !== null && clientIds.has(rawClient) ? rawClient : null;
    if (rawClient !== null && clientId === null) {
      discarded.push({ ref, reason: `o cliente “${rawClient}” não existe; a categoria foi mantida.` });
    }

    const rawPerson = asString(item?.person_id);
    const personId = rawPerson !== null && personIds.has(rawPerson) ? rawPerson : null;
    if (rawPerson !== null && personId === null) {
      discarded.push({ ref, reason: `a pessoa “${rawPerson}” não existe; a categoria foi mantida.` });
    }

    seen.add(ref);
    suggestions.push({
      ref,
      categoryId: category.id,
      categoryCode: category.code,
      clientId,
      personId,
      confidence,
      reasoning: asString(item?.reasoning) ?? "sem justificativa",
    });
  }

  /**
   * O que foi perguntado e nunca voltou (D127).
   *
   * `RESPONSE_SCHEMA` é um array de itens: ele obriga a **forma** de cada item, não obriga
   * o array a **cobrir** todos os refs enviados. O modelo omite as descrições que não
   * consegue ler em vez de chutar — e isso é o mesmo que a regra "nunca inventar número"
   * pede de nós. O defeito nunca foi a omissão: era ela não deixar rastro, e na tela
   * silêncio parecer cobertura.
   *
   * Medido em três chamadas reais com o mesmo prompt e o mesmo modelo: 18, 8 e 10 de 23
   * respondidas, e as três diziam `0 descartadas`.
   */
  const unanswered = subjects
    .map((subject) => subject.ref)
    .filter((ref) => !answered.has(ref));

  return { suggestions, discarded, unanswered };
}

/** Below this a suggestion is shown but not pre-selected (SPEC §8). */
export const CONFIDENCE_THRESHOLD = 0.8;
