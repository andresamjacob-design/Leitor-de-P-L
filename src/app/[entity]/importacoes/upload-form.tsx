"use client";

import { useActionState } from "react";
import { uploadImportAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { ACCOUNT_TYPE_LABEL, isCashAccount } from "@/lib/ledger-types";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { Account } from "@/lib/data/accounts";

export function UploadForm({ slug, accounts }: { slug: string; accounts: Account[] }) {
  const [state, action, pending] = useActionState(uploadImportAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <input type="hidden" name="slug" value={slug} />
      <FormError>{state.error}</FormError>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Conta"
          htmlFor="accountId"
          hint="Extrato vai para a conta corrente; fatura, para a conta do cartão."
        >
          <Select id="accountId" name="accountId" defaultValue={accounts[0]?.id ?? ""} required>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {ACCOUNT_TYPE_LABEL[account.type]}
                {isCashAccount(account.type) ? "" : " (cartão)"}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Arquivo"
          htmlFor="file"
          hint="Extrato em .xlsx ou .csv, fatura em .pdf. Até 15 MB."
        >
          <Input
            id="file"
            name="file"
            type="file"
            accept=".xlsx,.csv,.pdf"
            required
            className="py-1.5"
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Lendo o arquivo…" : "Importar"}
        </Button>
        <span className="text-xs text-muted">
          Nada entra no ledger agora — o arquivo vira uma lista para você conferir.
        </span>
      </div>
    </form>
  );
}
