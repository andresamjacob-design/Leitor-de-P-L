"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { destinoInterno } from "@/lib/destino-interno";

type State = { status: "idle" | "sending" | "sent" } | { status: "error"; message: string };

const DOMINIO = "@ddgroup.com.br";

/** A mensagem do Supabase vem em inglês e fala da API; isto diz o que fazer. */
function traduzir(mensagem: string): string {
  const m = mensagem.toLowerCase();
  if (m.includes("signups not allowed")) {
    return `Este e-mail não tem acesso. Entre com o seu e-mail ${DOMINIO}.`;
  }
  if (m.includes("database error saving new user")) {
    return `Só e-mails ${DOMINIO} podem criar acesso a este app.`;
  }
  if (m.includes("security purposes") || m.includes("rate limit")) {
    return "Muitos pedidos de e-mail seguidos. Espere alguns minutos e tente de novo.";
  }
  return mensagem;
}

/**
 * Login pelo link que o e-mail padrão do Supabase manda (D155, D157).
 *
 * O Andre preferiu não mexer nos modelos de e-mail do Supabase: o link de confirmação (conta
 * nova) ou de acesso (conta existente) leva a `/auth/callback`, que troca o código pela
 * sessão. Qualquer e-mail @ddgroup.com.br pode criar conta — o banco recusa outros domínios,
 * então pedir `shouldCreateUser` só para eles é conveniência, não a trava. Entrar não é ver:
 * os dados dependem de um administrador liberar a pessoa (tela Acessos).
 */
export function LoginForm({ redirect }: { redirect: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "sending" });
    const endereco = email.trim().toLowerCase();
    const volta = new URL("/auth/callback", window.location.origin);
    volta.searchParams.set("redirect", destinoInterno(redirect, window.location.origin));

    try {
      const { error } = await createClient().auth.signInWithOtp({
        email: endereco,
        options: {
          emailRedirectTo: volta.toString(),
          shouldCreateUser: endereco.endsWith(DOMINIO),
        },
      });
      if (error) {
        setState({ status: "error", message: traduzir(error.message) });
        return;
      }
      setState({ status: "sent" });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? traduzir(error.message) : "Erro desconhecido.",
      });
    }
  }

  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
        <p>
          Enviamos um link para <strong>{email.trim().toLowerCase()}</strong>. Abra o e-mail e
          clique no link.
        </p>
        <p className="text-muted">
          Abra o link <strong>neste mesmo navegador</strong>: ele só funciona onde foi pedido.
          Se for o seu primeiro acesso, o e-mail vem com o título de confirmação de cadastro.
        </p>
        <button
          type="button"
          className="self-start text-muted underline"
          onClick={() => setState({ status: "idle" })}
        >
          Trocar e-mail ou pedir de novo
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-sm">
        <span className="mb-1 block text-muted">E-mail</span>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          placeholder={`voce${DOMINIO}`}
          autoComplete="email"
        />
      </label>

      <Button type="submit" disabled={state.status === "sending"}>
        {state.status === "sending" ? "Enviando…" : "Enviar link de acesso"}
      </Button>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
