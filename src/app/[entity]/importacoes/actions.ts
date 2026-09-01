"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteContext } from "@/lib/actions/context";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import {
  approveStaged,
  discardImport,
  findImportByHash,
  getImport,
  rejectStaged,
  stageImport,
  type ImportFormat,
} from "@/lib/data/imports";
import { suggestForImport } from "@/lib/data/categorize";
import { suggestWithAi } from "@/lib/data/ai-suggestions";
import { readXlsx } from "@/lib/import/xlsx";
import { parseCsv } from "@/lib/import/csv";
import { parseItauStatement, reconcileStatement } from "@/lib/import/itau-statement";
import { readPdfPages } from "@/lib/import/pdf";
import { parseItauCardInvoice, reconcileCardInvoice } from "@/lib/import/itau-card";
import {
  looksLikeContabilizei,
  parseContabilizeiStatement,
  reconcileContabilizei,
} from "@/lib/import/contabilizei-statement";
import { formatMoney } from "@/lib/money";
import { formatPtBRDate } from "@/lib/dates";
import { isCashAccount } from "@/lib/ledger-types";
import { FormError, toFormState, type FormState } from "@/lib/form";
import type { AnyParse } from "@/lib/import/types";

const MAX_BYTES = 15 * 1024 * 1024;

function formatOf(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".pdf")) return "pdf";
  return null;
}

export async function uploadImportAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  let importId: string;
  const notices: string[] = [];

  try {
    const { entity, userId } = await requireWriteContext(slug);

    const accountId = String(data.get("accountId") ?? "");
    if (!accountId) throw new FormError("escolha a conta que este arquivo pertence.");

    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new FormError("escolha um arquivo.");
    }
    if (file.size > MAX_BYTES) {
      throw new FormError("o arquivo passa de 15 MB. Exporte um período menor.");
    }

    const format = formatOf(file.name);
    if (!format) {
      throw new FormError("formato não reconhecido. Envie um .xlsx, .csv ou .pdf.");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");

    const already = await findImportByHash(entity.id, fileHash);
    if (already) {
      throw new FormError(
        `este arquivo já foi importado em ${formatPtBRDate(already.createdAt.slice(0, 10))} ` +
          `como “${already.filename}”. Abra aquela importação em vez de repetir esta.`,
      );
    }

    const accounts = await listAccounts([entity.id], { includeInactive: true });
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (!account) throw new FormError("conta não encontrada.");

    // ---- Parse ------------------------------------------------------------
    let parse: AnyParse;
    let closingBalance = null;

    if (format === "pdf") {
      const pages = await readPdfPages(bytes);

      // Two very different documents arrive as `.pdf`: the Itaú card invoice and the
      // Contabilizei current-account statement. Which one it is comes from what the file
      // says about itself.
      if (looksLikeContabilizei(pages)) {
        const statement = parseContabilizeiStatement(pages);
        const reconciliation = reconcileContabilizei(statement);

        // This statement prints a running balance on every row, so a reading that does not
        // close is a reading that is wrong — refused, like a card invoice (D-B).
        if (!reconciliation.ok) throw new FormError(reconciliation.message);
        notices.push(reconciliation.message);
        for (const warning of statement.warnings) notices.push(warning.message);
        if (statement.discarded.length > 0) {
          notices.push(
            `${statement.discarded.length} linha${statement.discarded.length === 1 ? "" : "s"} ` +
              `descartada${statement.discarded.length === 1 ? "" : "s"}: ` +
              `${statement.discarded[0]?.reason ?? ""}.`,
          );
        }

        const closing = statement.declaredBalances.reduce<
          (typeof statement.declaredBalances)[number] | null
        >((latest, candidate) => (latest === null || candidate.date > latest.date ? candidate : latest), null);
        closingBalance = closing?.balance ?? null;
        parse = statement;
      } else {
      const invoice = parseItauCardInvoice(pages);
      const reconciliation = reconcileCardInvoice(invoice);

      // DECISIONS D-B: a card invoice that does not add up to its own printed total is a
      // misreading, and a misreading must never become a ledger entry.
      if (!reconciliation.ok) {
        throw new FormError(
          `${reconciliation.message} Extraí ${formatMoney(reconciliation.actual)} e a fatura ` +
            `declara ${reconciliation.expected === null ? "nada" : formatMoney(reconciliation.expected)}.`,
        );
      }

      if (isCashAccount(account.type)) {
        notices.push(
          `atenção: “${account.name}” não é uma conta de cartão. As compras entrariam no ` +
            "fluxo de caixa na data da compra, que é o erro que a fatura existe para evitar.",
        );
      }
      if (
        invoice.source.accountLastDigits &&
        account.lastDigits &&
        invoice.source.accountLastDigits !== account.lastDigits
      ) {
        notices.push(
          `a fatura é da conta final ${invoice.source.accountLastDigits} e você escolheu a ` +
            `conta final ${account.lastDigits}. O nome do arquivo não vale como prova — ` +
            "confira antes de aprovar.",
        );
      }

      parse = invoice;
      }
    } else {
      const rows =
        format === "csv"
          ? parseCsv(new TextDecoder("utf-8").decode(bytes))
          : (readXlsx(bytes)[0]?.rows ?? []);

      const statement = parseItauStatement(rows);
      const fatal = statement.warnings.find((warning) => warning.severity === "error");
      if (fatal) throw new FormError(fatal.message);

      const reconciliation = reconcileStatement(statement);
      // A statement that does not tie out is a warning, not a refusal: the file is still
      // the bank's own record, and the reader needs to know which days to look at.
      notices.push(reconciliation.message);
      for (const failure of reconciliation.failures.slice(0, 5)) {
        notices.push(
          `${formatPtBRDate(failure.date)}: o extrato diz ${formatMoney(failure.expected)}, ` +
            `a leitura dá ${formatMoney(failure.actual)}.`,
        );
      }

      if (statement.source.account && account.number) {
        const digits = (value: string) => value.replace(/\D/g, "");
        if (digits(statement.source.account) !== digits(account.number)) {
          notices.push(
            `o extrato é da conta ${statement.source.account} e você escolheu ` +
              `${account.number}.`,
          );
        }
      }

      // The closing balance is the one with the latest date, not the last in file order:
      // the Itaú export lists movements newest-first, so the final row is January's.
      const closing = statement.declaredBalances.reduce<
        (typeof statement.declaredBalances)[number] | null
      >((latest, candidate) => (latest === null || candidate.date > latest.date ? candidate : latest), null);
      closingBalance = closing?.balance ?? null;
      parse = statement;
    }

    if (parse.transactions.length === 0) {
      throw new FormError("o arquivo foi lido, mas não tem nenhum lançamento.");
    }

    // ---- Stage ------------------------------------------------------------
    const dates = parse.transactions.map((transaction) => transaction.occurredOn).sort();

    const staged = await stageImport({
      entityId: entity.id,
      accountId,
      filename: file.name,
      fileHash,
      format,
      periodStart: parse.kind === "statement" ? parse.periodStart : (dates[0] ?? null),
      periodEnd:
        parse.kind === "statement" ? parse.periodEnd : (dates[dates.length - 1] ?? null),
      statementClosingBalance: closingBalance,
      transactions: parse.transactions,
      userId,
    });

    importId = staged.id;

    // Suggestions run right after staging, so the review screen opens with the obvious
    // lines already filled in. They are suggestions: nothing is approved by this.
    const suggested = await suggestForImport(entity.id, accountId, staged.id);
    if (suggested.suggestions.size > 0) {
      notices.push(
        `${suggested.suggestions.size} linha${suggested.suggestions.size === 1 ? "" : "s"} ` +
          `com categoria sugerida; ${suggested.undecided} sem sugestão.`,
      );
    }
    if (staged.duplicates > 0) {
      notices.push(
        `${staged.duplicates} linha${staged.duplicates === 1 ? "" : "s"} já ` +
          `existia${staged.duplicates === 1 ? "" : "m"} no ledger e ` +
          `veio${staged.duplicates === 1 ? "" : "ram"} marcada${staged.duplicates === 1 ? "" : "s"} como duplicata.`,
      );
    }
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/importacoes`);
  redirect(`/${slug}/importacoes/${importId}?avisos=${encodeURIComponent(notices.join("\n"))}`);
}

export async function reviewImportAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const importId = String(data.get("importId") ?? "");
  const decision = String(data.get("decision") ?? "");

  try {
    const { entity, userId } = await requireWriteContext(slug);
    const record = await getImport(importId);
    if (!record) throw new FormError("importação não encontrada.");

    const selected = data.getAll("staged").map(String);
    if (selected.length === 0) throw new FormError("nenhuma linha selecionada.");

    if (decision === "reject") {
      const count = await rejectStaged(importId, selected);
      revalidatePath(`/${slug}/importacoes/${importId}`);
      return { notices: [`${count} linha${count === 1 ? "" : "s"} rejeitada${count === 1 ? "" : "s"}.`] };
    }

    const categories = await listCategories([entity.id], { includeInactive: true });
    const categoryByStagedId = new Map<string, string | null>();
    for (const id of selected) {
      const value = String(data.get(`categoria-${id}`) ?? "");
      categoryByStagedId.set(id, value === "" ? null : value);
    }

    const result = await approveStaged(
      entity.id,
      record.accountId,
      importId,
      selected,
      categoryByStagedId,
      categories,
      userId,
    );

    revalidatePath(`/${slug}/importacoes/${importId}`);
    revalidatePath(`/${slug}/lancamentos`);
    revalidatePath(`/${slug}/fluxo-de-caixa`);

    const notices = [
      `${result.approved} lançamento${result.approved === 1 ? "" : "s"} criado${result.approved === 1 ? "" : "s"}.`,
    ];
    if (result.duplicates > 0) {
      notices.push(`${result.duplicates} já existia${result.duplicates === 1 ? "" : "m"} e foi ignorada.`);
    }
    for (const failure of result.failures.slice(0, 5)) {
      notices.push(`“${failure.description}”: ${failure.reason}`);
    }
    return { notices };
  } catch (cause) {
    return toFormState(cause, data);
  }
}

export async function discardImportAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const importId = String(data.get("importId") ?? "");

  try {
    await requireWriteContext(slug);
    await discardImport(importId);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/importacoes`);
  redirect(`/${slug}/importacoes`);
}

/**
 * Layer 3: one batched LLM call for what the rules and the history left undecided.
 *
 * It writes only `suggested_*`. Nothing reaches the ledger from here — approval still
 * needs a human clicking on the review screen (SPEC §3, §8).
 */
export async function suggestWithAiAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const importId = String(data.get("importId") ?? "");

  try {
    const { entity } = await requireWriteContext(slug);
    const record = await getImport(importId);
    if (!record) throw new FormError("importação não encontrada.");

    const result = await suggestWithAi(entity.id, importId);
    revalidatePath(`/${slug}/importacoes/${importId}`);

    const notices = [
      result.considered === 0
        ? (result.warnings[0] ?? "nada a sugerir.")
        : `${result.suggested} de ${result.considered} linhas ganharam sugestão da IA ` +
          `(${result.model}). Nenhuma foi aprovada — isso continua sendo seu.`,
    ];

    // What the model got wrong is shown, not swallowed: it is the only way to notice a
    // prompt that stopped working.
    const dropped = result.discarded.slice(0, 5);
    for (const item of dropped) notices.push(`descartado: ${item.reason}`);
    if (result.discarded.length > dropped.length) {
      notices.push(`e mais ${result.discarded.length - dropped.length} descarte(s).`);
    }
    for (const warning of result.warnings) notices.push(warning);

    return { notices };
  } catch (cause) {
    return toFormState(cause, data);
  }
}
