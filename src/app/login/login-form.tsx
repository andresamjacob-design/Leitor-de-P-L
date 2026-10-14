"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Etapa =
  | { tipo: "email" }
  | { tipo: "enviando" }
  | { tipo: "codigo" }
  | { tipo: "verificando" };

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
  if (m.includes("expired") || m.includes("invalid")) {
    return "Código errado ou vencido. Confira o e-mail mais recente ou peça um código novo.";
  }
  if (m.includes("security purposes") || m.includes("rate limit")) {
    return "Muitos pedidos de código seguidos. Espere um minuto e tente de novo.";
  }
  return mensagem;
}

/**
 * Login por código enviado ao e-mail (D155).
 *
 * Qualquer e-mail @ddgroup.com.br pode criar conta — o banco recusa outros domínios, então
 * pedir `shouldCreateUser` só para eles é conveniência, não a trava. Entrar não é ver: os
 * dados dependem de um administrador liberar a pessoa (tela Acessos), e o RLS garante isso.
 */
export function LoginForm({ redirect }: { redirect: string }) {
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "email" });
  const [erro, setErro] = useState<string | null>(null);

  async function pedirCodigo(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setErro(null);
    setEtapa({ tipo: "enviando" });
    const endereco = email.trim().toLowerCase();
    try {
      const { error } = await createClient().auth.signInWithOtp({
        email: endereco,
        options: { shouldCreateUser: endereco.endsWith(DOMINIO) },
      });
      if (error) {
        setErro(traduzir(error.message));
        setEtapa({ tipo: "email" });
        return;
      }
      setEtapa({ tipo: "codigo" });
    } catch (error) {
      setErro(error instanceof Error ? traduzir(error.message) : "Erro desconhecido.");
      setEtapa({ tipo: "email" });
    }
  }

  async function verificar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setEtapa({ tipo: "verificando" });
    try {
      const { error } = await createClient().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: codigo.replace(/\D/g, ""),
        type: "email",
      });
      if (error) {
        setErro(traduzir(error.message));
        setEtapa({ tipo: "codigo" });
        return;
      }
      // Navegação completa, para o servidor ler o cookie de sessão que acabou de nascer.
      // Só caminho interno: `//outro.site` também começa com `/` e sairia do app.
      window.location.assign(/^\/(?!\/)/.test(redirect) ? redirect : "/");
    } catch (error) {
      setErro(error instanceof Error ? traduzir(error.message) : "Erro desconhecido.");
      setEtapa({ tipo: "codigo" });
    }
  }

  const mensagemDeErro = erro ? (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {erro}
    </p>
  ) : null;

  if (etapa.tipo === "codigo" || etapa.tipo === "verificando") {
    return (
      <form onSubmit={verificar} className="flex flex-col gap-3">
        <p className="text-sm">
          Enviamos um código para <strong>{email.trim().toLowerCase()}</strong>. Ele vale por
          alguns minutos.
        </p>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Código</span>
          <input
            id="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            pattern="[0-9 ]{6,10}"
            value={codigo}
            onChange={(event) => setCodigo(event.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-lg tracking-widest"
            placeholder="000000"
          />
        </label>
        <Button type="submit" disabled={etapa.tipo === "verificando"}>
          {etapa.tipo === "verificando" ? "Conferindo…" : "Entrar"}
        </Button>
        {mensagemDeErro}
        <div className="flex gap-4 text-sm">
          <button type="button" className="text-muted underline" onClick={() => pedirCodigo()}>
            Enviar outro código
          </button>
          <button
            type="button"
            className="text-muted underline"
            onClick={() => {
              setCodigo("");
              setErro(null);
              setEtapa({ tipo: "email" });
            }}
          >
            Trocar e-mail
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={pedirCodigo} className="flex flex-col gap-3">
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

      <Button type="submit" disabled={etapa.tipo === "enviando"}>
        {etapa.tipo === "enviando" ? "Enviando…" : "Enviar código"}
      </Button>

      {mensagemDeErro}
    </form>
  );
}
