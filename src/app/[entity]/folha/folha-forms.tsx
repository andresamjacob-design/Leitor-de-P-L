"use client";

import { useActionState } from "react";
import { novaLinhaAction, salvarSalarioAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";

function Avisos({ notices }: { notices?: string[] }) {
  return (
    <>
      {notices?.map((n) => (
        <p key={n} role="status" className="text-sm text-green-700 dark:text-green-400">
          {n}
        </p>
      ))}
    </>
  );
}

/** Um dos dois jeitos de mudar a folha de uma linha: salário a partir de um mês, ou só um mês. */
export function SalarioForm({
  slug,
  linhaId,
  tipo,
  mesPadrao,
}: {
  slug: string;
  linhaId: string;
  tipo: "vigente" | "so_no_mes";
  mesPadrao: string;
}) {
  const [state, action, pending] = useActionState(salvarSalarioAction, EMPTY_FORM_STATE);
  const id = `${tipo}-${linhaId}`;
  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="linha" value={linhaId} />
      <input type="hidden" name="tipo" value={tipo} />
      <h3 className="text-sm font-semibold">
        {tipo === "vigente" ? "Novo salário a partir de um mês" : "Valor só de um mês"}
      </h3>
      <p className="text-xs text-muted">
        {tipo === "vigente"
          ? "Para aumento, redução ou saída (salário zero). Vale desse mês em diante, até o próximo; os meses anteriores não mudam."
          : "Para entrada ou saída no meio do mês: o valor que você digitar vale só nesse mês. No seguinte, volta o salário vigente."}
      </p>
      <FormError>{state.error}</FormError>
      <Avisos notices={state.notices} />
      <div className="grid gap-3 sm:grid-cols-[10rem_12rem_auto] sm:items-end">
        <Field label={tipo === "vigente" ? "A partir de" : "Mês"} htmlFor={`${id}-mes`}>
          <Input id={`${id}-mes`} name="mes" type="month" required defaultValue={state.values?.mes ?? mesPadrao} />
        </Field>
        <Field label="Valor (R$)" htmlFor={`${id}-valor`}>
          <Input id={`${id}-valor`} name="valor" inputMode="decimal" required placeholder="8.000,00" defaultValue={state.values?.valor ?? ""} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

export function NovaLinhaForm({ slug, mesPadrao }: { slug: string; mesPadrao: string }) {
  const [state, action, pending] = useActionState(novaLinhaAction, EMPTY_FORM_STATE);
  const kept = (nome: string, padrao = "") => state.values?.[nome] ?? padrao;
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <FormError>{state.error}</FormError>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" htmlFor="nome" className="sm:col-span-2">
          <Input id="nome" name="nome" required defaultValue={kept("nome")} />
        </Field>
        <Field label="Cliente" htmlFor="cliente">
          <Input id="cliente" name="cliente" defaultValue={kept("cliente")} />
        </Field>
        <Field label="Squad" htmlFor="squad">
          <Input id="squad" name="squad" defaultValue={kept("squad")} />
        </Field>
        <Field label="Cargo" htmlFor="cargo">
          <Input id="cargo" name="cargo" defaultValue={kept("cargo")} />
        </Field>
        <Field label="Conta na DRE" htmlFor="conta">
          <Select id="conta" name="conta" defaultValue={kept("conta", "6.10")}>
            <option value="6.10">Time (salários)</option>
            <option value="6.11">Sócio (pró-labore)</option>
          </Select>
        </Field>
        <Field label="Salário a partir de" htmlFor="mes">
          <Input id="mes" name="mes" type="month" required defaultValue={kept("mes", mesPadrao)} />
        </Field>
        <Field label="Salário (R$)" htmlFor="valor">
          <Input id="valor" name="valor" inputMode="decimal" required placeholder="8.000,00" defaultValue={kept("valor")} />
        </Field>
      </div>
      <p className="text-xs text-muted">
        Se a pessoa entrou no meio do mês, cadastre o salário cheio a partir do mês seguinte e,
        na página dela, digite o valor só do mês de entrada.
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando…" : "Adicionar à folha"}
      </Button>
    </form>
  );
}
