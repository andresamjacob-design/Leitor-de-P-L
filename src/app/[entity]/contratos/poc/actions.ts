"use server";

import { revalidatePath } from "next/cache";
import { requireWriteContext } from "@/lib/actions/context";
import { applyRecognition, listContracts, savePocReport } from "@/lib/data/contracts";
import { readOptionalPeriod, toFormState, type FormState } from "@/lib/form";
import { isWithinRange, parsePercent } from "@/lib/recognition/percent";
import { periodOf, todayInSaoPaulo } from "@/lib/dates";

/** Reports every project that was filled in, then re-runs the engine for each of them. */
export async function saveBatchPocAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");

  try {
    const { entity, userId } = await requireWriteContext(slug);

    const period = readOptionalPeriod(data, "period", "O mês");
    if (!period) throw new Error("informe o mês do reporte.");

    const contracts = (await listContracts([entity.id])).filter(
      (contract) => contract.recognitionMethod === "poc",
    );

    const notices: string[] = [];
    let reported = 0;
    let written = 0;

    for (const contract of contracts) {
      const raw = String(data.get(`pct-${contract.id}`) ?? "").trim();
      if (raw === "") continue;

      let cumulative;
      try {
        cumulative = parsePercent(raw);
      } catch {
        notices.push(`${contract.name}: “${raw}” não é um percentual.`);
        continue;
      }
      if (!isWithinRange(cumulative)) {
        notices.push(`${contract.name}: o percentual tem que estar entre 0 e 100.`);
        continue;
      }

      const isCorrection = String(data.get(`fix-${contract.id}`) ?? "") === "on";
      await savePocReport(entity.id, contract.id, period, cumulative, isCorrection, userId);
      reported += 1;

      const through = period > periodOf(todayInSaoPaulo()) ? period : periodOf(todayInSaoPaulo());
      const result = await applyRecognition(contract, through, userId);
      written += result.written;
      for (const warning of result.warnings) notices.push(`${contract.name}: ${warning}`);
    }

    revalidatePath(`/${slug}/contratos`);
    revalidatePath(`/${slug}/contratos/poc`);
    revalidatePath(`/${slug}/dre`);

    if (reported === 0) {
      return { notices: ["nenhuma linha preenchida — nada foi reportado."], values: { period } };
    }

    notices.unshift(
      `${reported} projeto${reported === 1 ? "" : "s"} reportado${reported === 1 ? "" : "s"};` +
        ` ${written} linha${written === 1 ? "" : "s"} de competência gravada${written === 1 ? "" : "s"}.`,
    );
    return { notices, values: { period } };
  } catch (cause) {
    return toFormState(cause, data);
  }
}
