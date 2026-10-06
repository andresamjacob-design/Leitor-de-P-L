"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteContext } from "@/lib/actions/context";
import { accountBalances, listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import {
  approveStaged,
  discardImport,
  findImportByHash,
  getImport,
  listStaged,
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
import { FormError, toFormState, type FormState } from "@/lib/form";
import type { AnyParse } from "@/lib/import/types";
import { contaDoArquivo, type IdentidadeDoArquivo } from "@/lib/import/conta-do-arquivo";
import { decidirAprovacao, saldoDeConferencia } from "@/lib/import/aprovacao";
import { isCashAccount } from "@/lib/ledger-types";
import type { Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

const MAX_BYTES = 15 * 1024 * 1024;

function formatOf(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".pdf")) return "pdf";
  return null;
}

/** O que aconteceu com cada arquivo enviado. A tela mostra um por um, com o link de revisão. */
export type ResultadoDoArquivo =
  | {
      arquivo: string;
      ok: true;
      importId: string;
      conta: string;
      linhas: number;
      duplicatas: number;
      avisos: string[];
      /** Foi para o razão sem ninguém olhar (D145)? */
      aprovado: boolean;
      /** Quantos lançamentos entraram, e quantos deles sem categoria. */
      lancamentos: number;
      semCategoria: number;
      /** Por que ficou esperando revisão, quando ficou. */
      motivoRevisao: string | null;
    }
  | { arquivo: string; ok: false; erro: string };

export type EnvioState = { erro?: string; resultados?: ResultadoDoArquivo[] };

/** Um mês é um extrato e duas ou três faturas; vinte é folga, não convite. */
const MAX_ARQUIVOS = 20;

/**
 * Recebe vários arquivos de uma vez — extratos em xlsx/csv e faturas em pdf, misturados — e
 * descobre a conta de cada um **lendo o próprio arquivo** (D143). Não existe mais menu de
 * conta: ele abria na Contabilizei, que está inativa, e um extrato enviado sem mexer nele ia
 * para a conta errada.
 *
 * Cada arquivo é independente: um que falha não derruba os outros, e a tela diz qual falhou
 * e por quê. Nada entra no razão aqui — cada arquivo vira uma importação esperando revisão.
 */
export async function enviarArquivosAction(
  _previous: EnvioState,
  data: FormData,
): Promise<EnvioState> {
  const slug = String(data.get("slug") ?? "");

  try {
    const { entity, userId } = await requireWriteContext(slug);

    const arquivos = data
      .getAll("arquivos")
      .filter((valor): valor is File => valor instanceof File && valor.size > 0);
    if (arquivos.length === 0) return { erro: "escolha pelo menos um arquivo." };
    if (arquivos.length > MAX_ARQUIVOS) {
      return { erro: `envie no máximo ${MAX_ARQUIVOS} arquivos por vez.` };
    }

    const contas = await listAccounts([entity.id], { includeInactive: true });
    const resultados: ResultadoDoArquivo[] = [];
    for (const arquivo of arquivos) {
      try {
        resultados.push(await importarArquivo(entity.id, userId, arquivo, contas));
      } catch (cause) {
        resultados.push({
          arquivo: arquivo.name,
          ok: false,
          erro: cause instanceof Error ? cause.message : "não foi possível ler o arquivo.",
        });
      }
    }

    revalidatePath(`/${slug}/importacoes`);
    revalidatePath(`/${slug}/lancamentos`);
    revalidatePath(`/${slug}/fluxo-de-caixa`);
    revalidatePath(`/${slug}/dre`);
    return { resultados };
  } catch (cause) {
    return { erro: cause instanceof Error ? cause.message : "não foi possível enviar. Tente de novo." };
  }
}

async function importarArquivo(
  entityId: string,
  userId: string,
  file: File,
  contas: Awaited<ReturnType<typeof listAccounts>>,
): Promise<ResultadoDoArquivo> {
  const notices: string[] = [];

  if (file.size > MAX_BYTES) {
    throw new FormError("o arquivo passa de 15 MB. Exporte um período menor.");
  }

  const format = formatOf(file.name);
  if (!format) {
    throw new FormError("formato não reconhecido. Envie um .xlsx, .csv ou .pdf.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  const already = await findImportByHash(entityId, fileHash);
  if (already) {
    throw new FormError(
      `este arquivo já foi importado em ${formatPtBRDate(already.createdAt.slice(0, 10))} ` +
        `como “${already.filename}”.`,
    );
  }

  // ---- Parse ------------------------------------------------------------
  let parse: AnyParse;
  let closingBalance = null;
  let fechamento: { data: IsoDate; saldo: Cents } | null = null;
  let identidade: IdentidadeDoArquivo;

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
      fechamento = saldoDeConferencia(statement.declaredBalances);
      identidade = { tipo: "extrato", conta: statement.source.account };
      parse = statement;
    } else {
      const invoice = parseItauCardInvoice(pages);
      identidade = {
        tipo: "fatura",
        finalDaConta: invoice.source.accountLastDigits,
        finaisDosCartoes: invoice.source.cards.map((card) => card.lastDigits),
      };
      // Quem não é fatura nem extrato cai aqui sem identidade nenhuma; dizer isso vale mais
      // que a mensagem de soma que viria do `reconcile`.
      if (identidade.finalDaConta === null && identidade.finaisDosCartoes.length === 0) {
        throw new FormError(
          "não reconheci este PDF como fatura do Itaú nem como extrato da Contabilizei.",
        );
      }

      const reconciliation = reconcileCardInvoice(invoice);
      // DECISIONS D-B: a card invoice that does not add up to its own printed total is a
      // misreading, and a misreading must never become a ledger entry.
      if (!reconciliation.ok) {
        throw new FormError(
          `${reconciliation.message} Extraí ${formatMoney(reconciliation.actual)} e a fatura ` +
            `declara ${reconciliation.expected === null ? "nada" : formatMoney(reconciliation.expected)}.`,
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

    // The closing balance is the one with the latest date, not the last in file order:
    // the Itaú export lists movements newest-first, so the final row is January's.
    const closing = statement.declaredBalances.reduce<
      (typeof statement.declaredBalances)[number] | null
    >((latest, candidate) => (latest === null || candidate.date > latest.date ? candidate : latest), null);
    closingBalance = closing?.balance ?? null;
    fechamento = saldoDeConferencia(statement.declaredBalances);
    identidade = { tipo: "extrato", conta: statement.source.account };
    parse = statement;
  }

  if (parse.transactions.length === 0) {
    throw new FormError("o arquivo foi lido, mas não tem nenhum lançamento.");
  }

  // ---- A conta, lida do arquivo (D143) ----------------------------------
  const encontrada = contaDoArquivo(identidade, contas);
  if (!encontrada.ok) throw new FormError(encontrada.motivo);
  const account = encontrada.conta;

  // ---- Stage ------------------------------------------------------------
  const dates = parse.transactions.map((transaction) => transaction.occurredOn).sort();

  const staged = await stageImport({
    entityId,
    accountId: account.id,
    filename: file.name,
    fileHash,
    format,
    periodStart: parse.kind === "statement" ? parse.periodStart : (dates[0] ?? null),
    periodEnd: parse.kind === "statement" ? parse.periodEnd : (dates[dates.length - 1] ?? null),
    statementClosingBalance: closingBalance,
    transactions: parse.transactions,
    userId,
  });

  // Suggestions run right after staging, so the review screen opens with the obvious
  // lines already filled in. They are suggestions: nothing is approved by this.
  const suggested = await suggestForImport(entityId, account.id, staged.id);
  if (suggested.suggestions.size > 0) {
    notices.push(
      `${suggested.suggestions.size} linha${suggested.suggestions.size === 1 ? "" : "s"} ` +
        `com categoria sugerida; ${suggested.undecided} sem sugestão.`,
    );
  }

  // ---- Vai sozinho, se o banco assinar embaixo (D145) -------------------
  // O extrato só entra sem revisão se o saldo do app, com as linhas novas, der exatamente o
  // saldo que o próprio extrato declara. A fatura já teve o total conferido na leitura.
  const pendentes = (await listStaged(staged.id)).filter((row) => row.status === "pending");
  const ehCaixa = isCashAccount(account.type);
  const contaCompleta = contas.find((c) => c.id === account.id);
  const saldoNoRazao =
    ehCaixa && fechamento && contaCompleta
      ? ((await accountBalances([contaCompleta], { until: fechamento.data })).get(account.id) ?? null)
      : null;
  const decisao = decidirAprovacao({
    conta: ehCaixa ? "caixa" : "cartao",
    saldoNoRazao,
    fechamento,
    novas: pendentes,
  });

  let lancamentos = 0;
  let semCategoria = 0;
  let motivoRevisao: string | null = null;
  if (!decisao.aprovar) {
    motivoRevisao = decisao.motivo;
  } else if (pendentes.length > 0) {
    // As categorias são as que o motor acabou de sugerir; linha sem sugestão entra sem
    // categoria e aparece no fluxo como tal — o saldo é do banco, a categoria é opinião.
    const categorias = await listCategories([entityId], { includeInactive: true });
    const resultado = await approveStaged(
      entityId,
      account.id,
      staged.id,
      pendentes.map((row) => row.id),
      new Map(),
      categorias,
      userId,
    );
    lancamentos = resultado.approved;
    semCategoria = pendentes.filter((row) => row.suggestedCategoryId === null).length;
    for (const falha of resultado.failures.slice(0, 5)) {
      notices.push(`“${falha.description}” não entrou: ${falha.reason}`);
    }
    if (resultado.failures.length > 0) {
      motivoRevisao = `${resultado.failures.length} linha(s) não entraram e esperam revisão.`;
    }
  }

  return {
    arquivo: file.name,
    ok: true,
    importId: staged.id,
    conta: account.name,
    linhas: parse.transactions.length,
    duplicatas: staged.duplicates,
    avisos: notices,
    aprovado: decisao.aprovar && motivoRevisao === null,
    lancamentos,
    semCategoria,
    motivoRevisao,
  };
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
    // Omitir não é erro — é a IA se recusando a chutar sobre uma descrição que não diz o
    // suficiente —, mas sem esta linha "8 de 23 ganharam sugestão" deixaria quinze linhas
    // sem explicação nenhuma, e silêncio na tela parece cobertura (D127).
    if (result.unanswered > 0) {
      const uma = result.unanswered === 1;
      notices.push(
        `a IA não respondeu sobre ${result.unanswered} linha${uma ? "" : "s"} — ` +
          `${uma ? "a descrição não diz" : "as descrições não dizem"} o suficiente. ` +
          `${uma ? "Ela continua" : "Elas continuam"} sem sugestão.`,
      );
    }
    for (const warning of result.warnings) notices.push(warning);

    return { notices };
  } catch (cause) {
    return toFormState(cause, data);
  }
}
