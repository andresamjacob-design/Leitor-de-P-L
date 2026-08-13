"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type State = { status: "idle" | "sending" | "sent" } | { status: "error"; message: string };

/**
 * Magic link only, no self-signup (DECISIONS D20). An address with no `user_entities` row
 * can receive a link and sign in, and will then land on a screen telling it so — RLS
 * makes sure it sees no data either way.
 */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "sending" });

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: false,
        },
      });

      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }
      setState({ status: "sent" });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "erro desconhecido",
      });
    }
  }

  if (state.status === "sent") {
    return (
      <p className="rounded-lg border border-border bg-surface p-4 text-sm">
        Link enviado para <strong>{email}</strong>. Confira a caixa de entrada.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-sm">
        <span className="mb-1 block text-muted">E-mail</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          placeholder="voce@empresa.com.br"
          autoComplete="email"
        />
      </label>

      <Button type="submit" disabled={state.status === "sending"}>
        {state.status === "sending" ? "Enviando…" : "Enviar link de acesso"}
      </Button>

      {state.status === "error" ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      ) : null}
    </form>
  );
}
