import { EmptyState } from "@/components/empty-state";
import { LoginForm } from "@/app/login/login-form";
import { Marca } from "@/components/marca";
import { readSupabaseConfig } from "@/lib/env";

/** O link do e-mail voltou com erro (`/auth/callback`): diz o motivo em português. */
function motivoDoLinkFalhar(erro: string): string {
  const e = erro.toLowerCase();
  if (e.includes("code verifier") || e.includes("code_verifier")) {
    return "O link foi aberto em outro navegador. Peça um link novo e abra-o neste mesmo navegador.";
  }
  if (e.includes("expired") || e.includes("invalid")) {
    return "O link venceu ou já foi usado. Peça um novo.";
  }
  if (e === "missing_code") return "O link chegou incompleto. Peça um novo.";
  return "Não foi possível entrar com esse link. Peça um novo.";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const configured = readSupabaseConfig() !== null;
  const { redirect, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <Marca className="mb-6 h-14" />
      <h1 className="text-lg font-semibold">Financeiro</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Entre com o seu e-mail @ddgroup.com.br. Enviamos um link de acesso.
      </p>

      {error ? (
        <p role="alert" className="mb-4 rounded-md border border-border p-3 text-sm text-red-600 dark:text-red-400">
          {motivoDoLinkFalhar(error)}
        </p>
      ) : null}

      {configured ? (
        <LoginForm redirect={redirect ?? "/"} />
      ) : (
        <EmptyState title="Supabase não configurado">
          Copie <code className="font-mono">.env.example</code> para{" "}
          <code className="font-mono">.env.local</code> e preencha a URL e a chave anônima
          do projeto.
        </EmptyState>
      )}
    </main>
  );
}
