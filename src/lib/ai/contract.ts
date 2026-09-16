/**
 * Reading a contract PDF or DOCX into a **draft** (SPEC §9).
 *
 * The draft lands in `contracts.extracted_json` with `status = 'draft'`, and a draft
 * recognises nothing — the engine refuses it (see `planContract`). So the safety property
 * is not a promise in a comment: a contract nobody confirmed cannot produce a single
 * cent of revenue.
 *
 * Every extracted field is kept **as text, next to the snippet it came from**. Nothing is
 * parsed into a number here. The value only becomes money when a person reads the snippet,
 * agrees, and submits the contract form — which is the same form used for a contract typed
 * from scratch. That is what "no value used in a calculation comes from the LLM" means in
 * practice (SPEC §8).
 */

import { extractJson } from "@/lib/ai/provider";

export type ContractFieldName =
  | "clientName"
  | "name"
  | "type"
  | "totalValue"
  | "monthlyValue"
  | "startDate"
  | "endDate"
  | "billingTerms"
  | "paymentTerms"
  | "scope";

export type ContractField = {
  /** Exactly what the model read, as text. Never converted here. */
  value: string;
  /** The passage of the contract it came from, so a human can check it in one glance. */
  snippet: string | null;
};

export type ContractDraft = {
  fields: Partial<Record<ContractFieldName, ContractField>>;
  /** Fields the model was asked for and could not find. */
  missing: ContractFieldName[];
  warnings: string[];
};

export const FIELD_LABEL: Record<ContractFieldName, string> = {
  clientName: "Cliente",
  name: "Nome do contrato",
  type: "Tipo",
  totalValue: "Valor total",
  monthlyValue: "Valor mensal",
  startDate: "Início",
  endDate: "Fim",
  billingTerms: "Forma de cobrança",
  paymentTerms: "Condição de pagamento",
  scope: "Escopo",
};

const FIELDS = Object.keys(FIELD_LABEL) as ContractFieldName[];

/**
 * `output_config.format` — troca o `prefill: "{"` que costumava forçar o objeto. Cada
 * campo é `null` quando o contrato não o menciona: `additionalProperties: false` exige
 * toda chave em `required`, então "omitir" vira "value null" — `parseContractDraft` já
 * trata os dois do mesmo jeito.
 */
const FIELD_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        value: { type: "string" },
        snippet: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["value", "snippet"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
};

export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: Object.fromEntries(FIELDS.map((field) => [field, FIELD_SCHEMA])),
  required: FIELDS,
  additionalProperties: false,
};

export const CONTRACT_SYSTEM_PROMPT = `Você lê contratos de prestação de serviço brasileiros e extrai os dados principais.

Regras:
- Responda SOMENTE com um objeto JSON, sem texto antes ou depois.
- Para cada campo que encontrar, devolva {"value": "...", "snippet": "..."} onde "snippet"
  é o trecho literal do contrato de onde o valor saiu, com no máximo 200 caracteres.
- NÃO invente. Se o contrato não diz, omita o campo. Omitir é o comportamento correto.
- Não converta nem calcule nada: copie o valor como está escrito no contrato.
- "type" deve ser "retainer" (suporte contínuo, mensalidade recorrente) ou "project"
  (escopo fechado, com início e fim).
- Datas: copie como aparecem no contrato.

Campos possíveis: clientName, name, type, totalValue, monthlyValue, startDate, endDate,
billingTerms, paymentTerms, scope.`;

/** How much of a contract goes to the model. Long enough for the terms, bounded on cost. */
const MAX_CHARS = 60_000;

export function buildContractPrompt(text: string): string {
  const trimmed = text.trim();
  const clipped =
    trimmed.length > MAX_CHARS
      ? `${trimmed.slice(0, MAX_CHARS)}\n\n[...documento truncado...]`
      : trimmed;

  return `CONTRATO\n\n${clipped}`;
}

type RawField = { value?: unknown; snippet?: unknown };

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  // A model that returns a number for a value is not wrong about the contract, only about
  // the format; the text form is what gets stored either way.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function parseContractDraft(text: string): ContractDraft {
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (cause) {
    return {
      fields: {},
      missing: FIELDS,
      warnings: [cause instanceof Error ? cause.message : "resposta ilegível"],
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { fields: {}, missing: FIELDS, warnings: ["a resposta não é um objeto."] };
  }

  const source = parsed as Record<string, unknown>;
  const fields: Partial<Record<ContractFieldName, ContractField>> = {};
  const missing: ContractFieldName[] = [];
  const warnings: string[] = [];

  for (const field of FIELDS) {
    const raw = source[field];
    if (raw === undefined || raw === null) {
      missing.push(field);
      continue;
    }

    // A bare string is accepted, but then there is no snippet to check it against.
    const candidate: RawField = typeof raw === "object" ? (raw as RawField) : { value: raw };
    const value = asText(candidate.value);
    if (value === null) {
      missing.push(field);
      continue;
    }

    const snippet = asText(candidate.snippet);
    if (snippet === null) {
      warnings.push(
        `“${FIELD_LABEL[field]}” veio sem o trecho de origem — confira no contrato antes de aceitar.`,
      );
    }

    fields[field] = { value, snippet: snippet === null ? null : snippet.slice(0, 400) };
  }

  const type = fields.type?.value;
  if (type && type !== "retainer" && type !== "project") {
    warnings.push(`o tipo “${type}” não é reconhecido; escolha à mão entre contínuo e projeto.`);
    delete fields.type;
    missing.push("type");
  }

  if (Object.keys(fields).length === 0) {
    warnings.push("a IA não encontrou nenhum campo neste documento.");
  }

  return { fields, missing, warnings };
}

/**
 * What the contract form should start with.
 *
 * Only text the form itself will re-validate: money still goes through `parseMoney` and
 * dates through the date input, exactly as if they had been typed. Nothing skips a check
 * because an LLM produced it.
 */
export function draftToFormDefaults(draft: ContractDraft): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const [field, content] of Object.entries(draft.fields)) {
    defaults[field] = content.value;
  }
  return defaults;
}
