"use server";

import { requireWriteContext } from "@/lib/actions/context";
import { getAiProvider, AiUnavailableError } from "@/lib/ai/provider";
import {
  buildContractPrompt,
  CONTRACT_SYSTEM_PROMPT,
  parseContractDraft,
  RESPONSE_SCHEMA,
  type ContractDraft,
} from "@/lib/ai/contract";
import { readPdfPages } from "@/lib/import/pdf";
import { readDocx } from "@/lib/import/docx";
import { toDocumentLines } from "@/lib/import/layout";
import { FormError, toFormState, type FormState } from "@/lib/form";

const MAX_BYTES = 15 * 1024 * 1024;

export type ExtractState = FormState & {
  draft?: ContractDraft;
  filename?: string;
};

async function textOf(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) return readDocx(bytes);

  if (name.endsWith(".pdf")) {
    const pages = await readPdfPages(bytes);
    return toDocumentLines(pages)
      .map((line) => line.text)
      .join("\n");
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return new TextDecoder().decode(bytes);
  }

  throw new FormError("formato não reconhecido. Envie um .pdf, .docx ou .txt.");
}

/**
 * Reads a contract into a draft (SPEC §9).
 *
 * The draft is returned to the screen, not written anywhere. It becomes a contract only
 * when a person reads each field beside the passage it came from and submits the ordinary
 * contract form — where the money is parsed and the dates validated exactly as if they
 * had been typed.
 */
export async function extractContractAction(
  _previous: ExtractState,
  data: FormData,
): Promise<ExtractState> {
  try {
    await requireWriteContext(String(data.get("slug") ?? ""));

    const provider = getAiProvider();
    if (!provider) {
      throw new AiUnavailableError(
        "a IA não está configurada. Defina ANTHROPIC_API_KEY em .env.local — " +
          "dá para cadastrar o contrato à mão do mesmo jeito.",
      );
    }

    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) throw new FormError("escolha um arquivo.");
    if (file.size > MAX_BYTES) throw new FormError("o arquivo passa de 15 MB.");

    const text = await textOf(file);
    if (text.trim().length < 200) {
      throw new FormError(
        "quase não saiu texto deste arquivo. Se for um PDF escaneado, não dá para ler — " +
          "cadastre o contrato à mão.",
      );
    }

    const response = await provider.complete({
      system: CONTRACT_SYSTEM_PROMPT,
      prompt: buildContractPrompt(text),
      maxTokens: 4000,
      responseSchema: RESPONSE_SCHEMA,
    });

    return { draft: parseContractDraft(response.text), filename: file.name };
  } catch (cause) {
    return toFormState(cause, data);
  }
}
