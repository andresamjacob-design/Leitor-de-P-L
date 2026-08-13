"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveCashEntryAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormNotice, Input, Select } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { periodOf } from "@/lib/dates";
import { ACCOUNT_TYPE_LABEL, isCashAccount } from "@/lib/ledger-types";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { CashEntry } from "@/lib/data/cash-entries";
import type { Account } from "@/lib/data/accounts";
import type { Category } from "@/lib/data/categories";

export function EntryForm({
  slug,
  entry,
  accounts,
  categories,
  counterpartAccountId,
}: {
  slug: string;
  entry: CashEntry | null;
  accounts: Account[];
  categories: Category[];
  counterpartAccountId: string | null;
}) {
  const [state, action, pending] = useActionState(saveCashEntryAction, EMPTY_FORM_STATE);

  // What the user typed wins over what was loaded: a rejected save comes back here with
  // the submitted values, and React would otherwise have blanked the whole form.
  const kept = (name: string, fallback: string) => state.values?.[name] ?? fallback;

  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? "");
  const [accountId, setAccountId] = useState(entry?.accountId ?? accounts[0]?.id ?? "");
  const [occurredOn, setOccurredOn] = useState(entry?.occurredOn ?? "");

  const category = categories.find((candidate) => candidate.id === categoryId) ?? null;
  const isTransfer = category?.kind === "transfer";
  const duplicate = state.error?.includes("lançamento idêntico") ?? false;

  const defaultMonth = occurredOn ? periodOf(occurredOn).slice(0, 7) : "";

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}

      <FormError>{state.error}</FormError>
      {state.notices?.map((notice) => <FormNotice key={notice}>{notice}</FormNotice>)}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Conta" htmlFor="accountId">
          <Select
            id="accountId"
            name="accountId"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            required
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {ACCOUNT_TYPE_LABEL[account.type]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Data"
          htmlFor="occurredOn"
          hint="O dia em que o dinheiro se moveu de verdade."
        >
          <Input
            id="occurredOn"
            name="occurredOn"
            type="date"
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
            required
          />
        </Field>

        <Field label="Sentido" htmlFor="direction">
          <Select id="direction" name="direction" defaultValue={kept("direction", entry?.direction ?? "out")}>
            <option value="out">Saída</option>
            <option value="in">Entrada</option>
          </Select>
        </Field>

        <Field label="Valor" htmlFor="amount" hint="Sempre positivo — o sentido está acima.">
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            defaultValue={kept("amount", entry ? formatMoney(entry.amount) : "")}
            placeholder="0,00"
            required
          />
        </Field>

        <Field label="Descrição" htmlFor="description" className="sm:col-span-2">
          <Input
            id="description"
            name="description"
            defaultValue={kept("description", entry?.description ?? "")}
            placeholder="PIX salário — Maria"
            required
          />
        </Field>

        <Field
          label="Categoria"
          htmlFor="categoryId"
          hint="Sem categoria o lançamento continua no fluxo de caixa, numa linha “Sem categoria”."
          className="sm:col-span-2"
        >
          <Select
            id="categoryId"
            name="categoryId"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">— sem categoria —</option>
            {categories.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code} · {candidate.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Competência"
          htmlFor="competencePeriod"
          hint={
            isTransfer
              ? "Transferência não entra no DRE, então a competência não muda nada aqui."
              : "Deixe vazio para usar o mês da data. Preencha quando o DRE for outro mês — salário de janeiro pago em fevereiro, compra no cartão paga depois."
          }
          className="sm:col-span-2"
        >
          <Input
            id="competencePeriod"
            name="competencePeriod"
            type="month"
            defaultValue={kept("competencePeriod", entry?.competencePeriod?.slice(0, 7) ?? "")}
            placeholder={defaultMonth}
          />
        </Field>

        {isTransfer ? (
          <Field
            label="Conta de destino"
            htmlFor="counterpartAccountId"
            hint="Cria a contrapartida na outra conta e pareia as duas pontas. É o que faz o pagamento de fatura baixar a dívida do cartão."
            className="sm:col-span-2"
          >
            <Select
              id="counterpartAccountId"
              name="counterpartAccountId"
              defaultValue={kept("counterpartAccountId", counterpartAccountId ?? "")}
            >
              <option value="">— sem contrapartida —</option>
              {accounts
                .filter((account) => account.id !== accountId)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {ACCOUNT_TYPE_LABEL[account.type]}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Fornecedor" htmlFor="vendor" hint="Opcional. Ajuda a categorizar depois.">
          <Input id="vendor" name="vendor" defaultValue={kept("vendor", entry?.vendor ?? "")} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isIntercompany"
          defaultChecked={state.values ? state.values.isIntercompany === "on" : (entry?.isIntercompany ?? false)}
          className="size-4"
        />
        Movimento entre as duas entidades (intercompany)
      </label>

      {duplicate ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allowDuplicate" className="size-4" />
          Gravar mesmo assim — é uma segunda ocorrência de verdade
        </label>
      ) : (
        <input type="hidden" name="allowDuplicate" value="false" />
      )}

      {accounts.some((account) => account.id === accountId && !isCashAccount(account.type)) ? (
        <p className="text-xs text-muted">
          Esta é uma conta de cartão: o lançamento entra no DRE na data da compra e{" "}
          <strong>não</strong> aparece no fluxo de caixa. O caixa só se move quando a fatura
          é paga pela conta corrente.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        <Link
          href={`/${slug}/lancamentos`}
          className="text-sm text-muted hover:text-foreground"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
