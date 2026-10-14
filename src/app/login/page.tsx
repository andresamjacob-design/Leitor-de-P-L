import { EmptyState } from "@/components/empty-state";
import { LoginForm } from "@/app/login/login-form";
import { readSupabaseConfig } from "@/lib/env";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const configured = readSupabaseConfig() !== null;
  const { redirect } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <h1 className="text-lg font-semibold">Financeiro</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Entre com o seu e-mail @ddgroup.com.br. Enviamos um código para você digitar aqui.
      </p>

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
