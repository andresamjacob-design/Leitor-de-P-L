"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveContractAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { Contract } from "@/lib/data/contracts";
import type { Client } from "@/lib/data/clients";
import type { RecognitionMethod } from "@/lib/recognition/engine";

const METHOD_LABEL: Record<RecognitionMethod, string> = {
  straight_line: "Linha reta — mensalidade ou total dividido pelo prazo",
  poc: "POC — percentual de conclusão reportado por mês",
  manual: "Manual — as linhas são lançadas à mão",
};

export function ContractForm({
  slug,
  contract,
  clients,
  revenueCategories,
  amend = false,
  defaults,
  clientNameHint,
}: {
  slug: string;
  contract: Contract | null;
  clients: Client[];
  /** The revenue lines of the chart, for a contract that does not fit its type. */
  revenueCategories: { id: string; code: string; name: string }[];
  amend?: boolean;
  /** Values proposed by the contract extraction (SPEC §9). Still validated on submit. */
  defaults?: Record<string, string>;
  clientNameHint?: string;
}) {
  const [state, action, pending] = useActionState(saveContractAction, EMPTY_FORM_STATE);
  // What was submitted wins; then an extraction's proposal; then what is on file.
  const kept = (name: string, fallback: string) =>
    state.values?.[name] ?? defaults?.[name] ?? fallback;
  const [method, setMethod] = useState<RecognitionMethod>(
    contract?.recognitionMethod ?? "straight_line",
  );

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      {contract ? <input type="hidden" name="id" value={contract.id} /> : null}
      {amend ? <input type="hidden" name="amend" value="true" /> : null}

      <FormError>{state.error}</FormError>

      {amend ? (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
          Um aditivo cria uma versão nova do contrato. Os meses já reconhecidos ficam como
          estão — o que muda vale daqui para a frente (D13).
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Cliente"
          htmlFor="clientId"
          className="sm:col-span-2"
          hint={
            clientNameHint
              ? `O contrato diz “${clientNameHint}”. Escolha o cliente correspondente, ou cadastre-o antes.`
              : undefined
          }
        >
          <Select id="clientId" name="clientId" defaultValue={kept("clientId", contract?.clientId ?? "")} required>
            <option value="">Escolha…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Nome do contrato" htmlFor="name" className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={kept("name", contract?.name ?? "")} required />
        </Field>

        <Field label="Tipo" htmlFor="type">
          <Select id="type" name="type" defaultValue={kept("type", contract?.type ?? "retainer")}>
            <option value="retainer">Suporte contínuo</option>
            <option value="project">Projeto</option>
          </Select>
        </Field>

        <Field label="Situação" htmlFor="status" hint="Rascunho não reconhece nada.">
          <Select id="status" name="status" defaultValue={kept("status", contract?.status ?? "draft")}>
            <option value="draft">Rascunho</option>
            <option value="active">Ativo</option>
            <option value="completed">Concluído</option>
            <option value="cancelled">Cancelado</option>
          </Select>
        </Field>

        <Field
          label="Conta de receita"
          htmlFor="categoryId"
          hint="Em branco, sai do tipo: 3.01 para contínuo, 3.02 para projeto."
          className="sm:col-span-2"
        >
          <Select
            id="categoryId"
            name="categoryId"
            defaultValue={kept("categoryId", contract?.categoryOverrideId ?? "")}
          >
            <option value="">— pelo tipo do contrato —</option>
            {revenueCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.code} · {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Reconhecimento"
          htmlFor="recognitionMethod"
          className="sm:col-span-2"
          hint={METHOD_LABEL[method]}
        >
          <Select
            id="recognitionMethod"
            name="recognitionMethod"
            value={method}
            onChange={(event) => setMethod(event.target.value as RecognitionMethod)}
          >
            <option value="straight_line">Linha reta</option>
            <option value="poc">POC</option>
            <option value="manual">Manual</option>
          </Select>
        </Field>

        <Field
          label="Valor mensal"
          htmlFor="monthlyValue"
          hint="Quando o contrato declara uma mensalidade, ela vale sobre o total."
        >
          <Input
            id="monthlyValue"
            name="monthlyValue"
            inputMode="decimal"
            defaultValue={kept("monthlyValue", contract?.monthlyValue ? formatMoney(contract.monthlyValue) : "")}
            placeholder="0,00"
          />
        </Field>

        <Field
          label="Valor total"
          htmlFor="totalValue"
          hint={method === "poc" ? "Obrigatório: é sobre ele que o percentual incide." : "Opcional."}
        >
          <Input
            id="totalValue"
            name="totalValue"
            inputMode="decimal"
            defaultValue={kept("totalValue", contract?.totalValue ? formatMoney(contract.totalValue) : "")}
            placeholder="0,00"
          />
        </Field>

        <Field label="Início" htmlFor="startDate">
          <Input id="startDate" name="startDate" type="date" defaultValue={kept("startDate", contract?.startDate ?? "")} />
        </Field>

        <Field label="Fim" htmlFor="endDate" hint="Vazio = contrato aberto, reconhece enquanto ativo.">
          <Input id="endDate" name="endDate" type="date" defaultValue={kept("endDate", contract?.endDate ?? "")} />
        </Field>

        <Field label="Forma de cobrança" htmlFor="billingTerms">
          <Input id="billingTerms" name="billingTerms" defaultValue={kept("billingTerms", contract?.billingTerms ?? "")} placeholder="Mensal, Kickoff, 1 NF…" />
        </Field>

        <Field label="Condição de pagamento" htmlFor="paymentTerms">
          <Input id="paymentTerms" name="paymentTerms" defaultValue={kept("paymentTerms", contract?.paymentTerms ?? "")} placeholder="30 dias" />
        </Field>

        <Field label="Observações do contrato" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={kept("notes", "")} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="prorateFirstLastMonth"
          defaultChecked={
            state.values
              ? state.values.prorateFirstLastMonth === "on"
              : (contract?.prorateFirstLastMonth ?? true)
          }
          className="size-4"
        />
        Prorratear o primeiro e o último mês pelos dias
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isIntercompany"
          defaultChecked={
            state.values ? state.values.isIntercompany === "on" : (contract?.isIntercompany ?? false)
          }
          className="size-4"
        />
        Contrato entre as duas entidades (intercompany)
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : amend ? "Criar aditivo" : "Salvar"}
        </Button>
        <Link href={`/${slug}/contratos`} className="text-sm text-muted hover:text-foreground">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
