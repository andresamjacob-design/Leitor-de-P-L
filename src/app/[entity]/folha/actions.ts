"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteContext } from "@/lib/actions/context";
import { criarLinha, regerarFolha, removerValor, salvarValor } from "@/lib/data/folha";
import { todayInSaoPaulo } from "@/lib/dates";
import { FormError, readOptionalText, readText, toFormState, type FormState } from "@/lib/form";
import { parseMoney } from "@/lib/money";

/** Do mês mudado até o mês atual: os meses que já existem na DRE e dependem dele. */
function mesesAte(mes: string, tipo: "vigente" | "so_no_mes"): string[] {
  const atual = `${todayInSaoPaulo().slice(0, 7)}-01`;
  if (mes > atual) return [];
  if (tipo === "so_no_mes") return [mes];
  const meses: string[] = [];
  for (let m = mes; m <= atual; ) {
    meses.push(m);
    const [a, mm] = m.split("-").map(Number) as [number, number];
    m = mm === 12 ? `${a + 1}-01-01` : `${a}-${String(mm + 1).padStart(2, "0")}-01`;
  }
  return meses;
}

function lerMes(data: FormData): string {
  const mes = readText(data, "mes", "O mês");
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new FormError("O mês não é válido.");
  return `${mes}-01`;
}

function lerValor(data: FormData): bigint {
  const valor = parseMoney(readText(data, "valor", "O valor"));
  if (valor < 0n) throw new FormError("O valor não pode ser negativo.");
  return valor;
}

/** "Novo salário a partir de" ou "valor só deste mês", numa linha da folha. */
export async function salvarSalarioAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const linhaId = String(data.get("linha") ?? "");
  try {
    const { entity } = await requireWriteContext(slug);
    const tipo = data.get("tipo") === "so_no_mes" ? "so_no_mes" : "vigente";
    const mes = lerMes(data);
    const valor = lerValor(data);
    await salvarValor(entity.id, linhaId, mes, valor, tipo);
    await regerarFolha(entity.id, mesesAte(mes, tipo));
  } catch (cause) {
    return toFormState(cause, data);
  }
  revalidatePath(`/${slug}/folha`);
  revalidatePath(`/${slug}/dre`);
  return { notices: ["Salvo. A folha dos meses afetados foi recalculada."] };
}

export async function removerSalarioAction(data: FormData): Promise<void> {
  const slug = String(data.get("slug") ?? "");
  const valorId = String(data.get("valor") ?? "");
  const mes = String(data.get("mes") ?? "");
  const tipo = data.get("tipo") === "so_no_mes" ? "so_no_mes" : "vigente";
  const { entity } = await requireWriteContext(slug);
  await removerValor(entity.id, valorId);
  await regerarFolha(entity.id, mesesAte(mes, tipo));
  revalidatePath(`/${slug}/folha`);
}

/** Alguém novo na folha, já com o salário vigente. */
export async function novaLinhaAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  let id = "";
  try {
    const { entity } = await requireWriteContext(slug);
    const conta = data.get("conta") === "6.11" ? "6.11" : "6.10";
    const mes = lerMes(data);
    const valor = lerValor(data);
    id = await criarLinha(entity.id, {
      nome: readText(data, "nome", "O nome"),
      cliente: readOptionalText(data, "cliente"),
      squad: readOptionalText(data, "squad"),
      cargo: readOptionalText(data, "cargo"),
      conta,
    });
    await salvarValor(entity.id, id, mes, valor, "vigente");
    await regerarFolha(entity.id, mesesAte(mes, "vigente"));
  } catch (cause) {
    return toFormState(cause, data);
  }
  revalidatePath(`/${slug}/folha`);
  redirect(`/${slug}/folha/${id}`);
}
