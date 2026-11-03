/**
 * The one place an LLM is called (SPEC §3).
 *
 * Everything above this file talks to `AiProvider`, so the model is swappable and the
 * tests inject a fake instead of reaching the network. Anthropic is the default and the
 * key is an env var.
 *
 * Two rules hold across the whole AI layer, and they are enforced by the callers, not by
 * politeness:
 *
 *   - **No LLM call writes to a ledger table.** Suggestions land in `suggested_*` columns
 *     or in `contracts.extracted_json`, and a human moves them from there.
 *   - **The LLM never sees an amount used in a calculation.** It classifies text. Numbers
 *     come from the parsers (SPEC §8).
 *
 * With no key configured, `getAiProvider()` returns null and every screen falls back to
 * saying so. The system is fully usable with zero AI calls (SPEC §2).
 */

export type AiRequest = {
  system: string;
  prompt: string;
  maxTokens?: number;
  /**
   * Constrains the reply to this JSON Schema, via `output_config.format`. Replaces the
   * `prefill: "["` trick that used to fake JSON-only output — assistant-turn prefill
   * returns 400 on Sonnet 5, Opus 5, and the whole 4.6+ family.
   */
  responseSchema?: Record<string, unknown>;
  /**
   * Imagens enviadas antes do texto, na ordem dada. Só o leitor de prints usa (D168): o
   * BS2 não exporta extrato, e o print é o único registro que o banco dá.
   */
  images?: AiImage[];
};

export type AiImage = {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Os bytes em base64, sem o prefixo `data:`. */
  base64: string;
};

export type AiResponse = {
  text: string;
  model: string;
};

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const DEFAULT_MODEL = "claude-opus-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 120_000;

/** Sem imagem, o conteúdo continua sendo a string de sempre — nada muda para a categorização. */
export function userContent(prompt: string, images: readonly AiImage[]) {
  if (images.length === 0) return prompt;
  return [
    ...images.map((image) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
    })),
    { type: "text" as const, text: prompt },
  ];
}

function anthropicProvider(apiKey: string, model: string): AiProvider {
  return {
    name: "anthropic",
    model,
    async complete({ system, prompt, maxTokens = 4096, responseSchema, images = [] }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": API_VERSION,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: userContent(prompt, images) }],
            ...(responseSchema
              ? { output_config: { format: { type: "json_schema", schema: responseSchema } } }
              : {}),
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new AiUnavailableError(
            `a chamada de IA falhou (${response.status}). ${detail.slice(0, 200)}`,
          );
        }

        const body = (await response.json()) as {
          content?: { type: string; text?: string }[];
          model?: string;
        };

        const text = (body.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("");

        return { text, model: body.model ?? model };
      } catch (cause) {
        if (cause instanceof AiUnavailableError) throw cause;
        if (cause instanceof Error && cause.name === "AbortError") {
          throw new AiUnavailableError("a chamada de IA demorou demais e foi cancelada.");
        }
        throw new AiUnavailableError(
          `não foi possível falar com a IA: ${cause instanceof Error ? cause.message : "erro desconhecido"}`,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/** An env var set to an empty string means "not set" — a `.env` file full of blanks. */
function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

/** The configured provider, or null when there is no key — which is a valid state. */
export function getAiProvider(): AiProvider | null {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (apiKey === null) return null;
  return anthropicProvider(apiKey, env("ANTHROPIC_MODEL") ?? DEFAULT_MODEL);
}

export function isAiConfigured(): boolean {
  return env("ANTHROPIC_API_KEY") !== null;
}

/**
 * Pulls the JSON out of a reply.
 *
 * Models wrap JSON in prose or in a fenced block often enough that refusing those replies
 * would mean discarding good answers. Anything that is still not JSON is an error the
 * caller reports — never a partial parse.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? (fenced[1] as string) : trimmed;

  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("a resposta da IA não contém JSON.");

  const opening = candidate[start];
  const closing = opening === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(closing);
  if (end <= start) throw new Error("a resposta da IA tem JSON incompleto.");

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new Error("a resposta da IA não é um JSON válido.");
  }
}
