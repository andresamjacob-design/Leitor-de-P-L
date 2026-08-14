"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveInvoiceAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { Invoice } from "@/lib/data/invoices";
import type { Client } from "@/lib/data/clients";
import type { Contract } from "@/lib/data/contracts";

export function InvoiceForm({
  slug,
  invoice,
  clients,
  contracts,
  defaultContractId,
}: {
  slug: string;
  invoice: Invoice | null;
  clients: Client[];
  contracts: Contract[];
  defaultContractId?: string;
}) {
  const [state, action, pending] = useActionState(saveInvoiceAction, EMPTY_FORM_STATE);
  const kept = (name: string, fallback: string) => state.values?.[name] ?? fallback;

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      {invoice ? <input type="hidden" name="id" value={invoice.id} /> : null}

      <FormError>{state.error}</FormError>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Cliente" htmlFor="clientId">
          <Select id="clientId" name="clientId" defaultValue={kept("clientId", invoice?.clientId ?? "")} required>
            <option value="">Escolha…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Contrato" htmlFor="contractId" hint="Opcional, mas é o que liga a NF à conciliação.">
          <Select
            id="contractId"
            name="contractId"
            defaultValue={kept("contractId", invoice?.contractId ?? defaultContractId ?? "")}
          >
            <option value="">— nenhum —</option>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>{contract.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Número" htmlFor="number">
          <Input id="number" name="number" defaultValue={kept("number", invoice?.number ?? "")} required />
        </Field>

        <Field label="Série" htmlFor="series">
          <Input id="series" name="series" defaultValue={kept("series", invoice?.series ?? "")} />
        </Field>

        <Field label="Emissão" htmlFor="issueDate">
          <Input id="issueDate" name="issueDate" type="date" defaultValue={kept("issueDate", invoice?.issueDate ?? "")} required />
        </Field>

        <Field
          label="Competência"
          htmlFor="servicePeriod"
          hint="O mês do serviço, que é o que vale para o DRE — não a data de emissão (D6)."
        >
          <Input
            id="servicePeriod"
            name="servicePeriod"
            type="month"
            defaultValue={kept("servicePeriod", invoice?.servicePeriod?.slice(0, 7) ?? "")}
            required
          />
        </Field>

        <Field label="Vencimento" htmlFor="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={kept("dueDate", invoice?.dueDate ?? "")} />
        </Field>

        <Field label="Situação" htmlFor="status">
          <Select id="status" name="status" defaultValue={kept("status", invoice?.status ?? "issued")}>
            <option value="issued">Emitida</option>
            <option value="partially_paid">Parcialmente paga</option>
            <option value="paid">Paga</option>
            <option value="cancelled">Cancelada</option>
          </Select>
        </Field>

        <Field label="Valor bruto" htmlFor="grossAmount">
          <Input
            id="grossAmount"
            name="grossAmount"
            inputMode="decimal"
            defaultValue={kept("grossAmount", invoice ? formatMoney(invoice.grossAmount) : "")}
            placeholder="0,00"
            required
          />
        </Field>

        <Field label="Valor líquido" htmlFor="netAmount" hint="Se houver retenção na fonte.">
          <Input
            id="netAmount"
            name="netAmount"
            inputMode="decimal"
            defaultValue={kept("netAmount", invoice?.netAmount ? formatMoney(invoice.netAmount) : "")}
            placeholder="0,00"
          />
        </Field>

        <Field label="Observações" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={kept("notes", invoice?.notes ?? "")} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isIntercompany"
          defaultChecked={state.values ? state.values.isIntercompany === "on" : (invoice?.isIntercompany ?? false)}
          className="size-4"
        />
        NF entre as duas entidades (intercompany)
      </label>

      <p className="text-xs text-muted">
        Lançar a NF não cria receita no DRE: o reconhecimento vem do contrato. A nota entra
        na conciliação como a coluna “faturado”, ao lado de “reconhecido” e “recebido”.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
        <Link href={`/${slug}/notas-fiscais`} className="text-sm text-muted hover:text-foreground">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
