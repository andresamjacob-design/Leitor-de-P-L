import { EmptyState } from "@/components/empty-state";
import { LoginForm } from "@/app/login/login-form";
import { readSupabaseConfig } from "@/lib/env";

export default function LoginPage() {
  const configured = readSupabaseConfig() !== null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <h1 className="text-lg font-semibold">Financeiro</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Entre com o seu e-mail. Enviamos um link de acesso.
      </p>

      {configured ? (
        <LoginForm />
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
