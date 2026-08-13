"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveAccountAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/ledger-types";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { Account } from "@/lib/data/accounts";

export function AccountForm({ slug, account }: { slug: string; account: Account | null }) {
  const [state, action, pending] = useActionState(saveAccountAction, EMPTY_FORM_STATE);

  // A rejected save comes back with what was typed; React would blank the form otherwise.
  const kept = (name: string, fallback: string) => state.values?.[name] ?? fallback;

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      {account ? <input type="hidden" name="id" value={account.id} /> : null}

      <FormError>{state.error}</FormError>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nome" htmlFor="name" className="sm:col-span-2">
          <Input
            id="name"
            name="name"
            defaultValue={kept("name", account?.name ?? "")}
            placeholder="Itaú — conta corrente"
            required
          />
        </Field>

        <Field label="Tipo" htmlFor="type">
          <Select id="type" name="type" defaultValue={kept("type", account?.type ?? "bank")}>
            {(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((type) => (
              <option key={type} value={type}>
                {ACCOUNT_TYPE_LABEL[type]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Instituição" htmlFor="institution">
          <Input
            id="institution"
            name="institution"
            defaultValue={kept("institution", account?.institution ?? "")}
            placeholder="Itaú Unibanco"
          />
        </Field>

        <Field label="Agência" htmlFor="branch">
          <Input id="branch" name="branch" defaultValue={kept("branch", account?.branch ?? "")} />
        </Field>

        <Field label="Conta" htmlFor="number">
          <Input id="number" name="number" defaultValue={kept("number", account?.number ?? "")} />
        </Field>

        <Field
          label="Final"
          htmlFor="lastDigits"
          hint="Últimos dígitos do cartão, como aparecem na fatura."
        >
          <Input
            id="lastDigits"
            name="lastDigits"
            defaultValue={kept("lastDigits", account?.lastDigits ?? "")}
            inputMode="numeric"
          />
        </Field>

        <Field
          label="Saldo de abertura"
          htmlFor="openingBalance"
          hint="O saldo real da conta na data abaixo. É de onde o fluxo de caixa parte."
        >
          <Input
            id="openingBalance"
            name="openingBalance"
            defaultValue={kept("openingBalance", account ? formatMoney(account.openingBalance) : "0,00")}
            inputMode="decimal"
            placeholder="0,00"
          />
        </Field>

        <Field label="Data do saldo de abertura" htmlFor="openingDate">
          <Input
            id="openingDate"
            name="openingDate"
            type="date"
            defaultValue={kept("openingDate", account?.openingDate ?? "2026-01-01")}
            required
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={state.values ? state.values.active === "on" : (account?.active ?? true)}
          className="size-4"
        />
        Conta ativa
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        <Link href={`/${slug}/contas`} className="text-sm text-muted hover:text-foreground">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
