import { PlaceholderPage } from "@/components/placeholder-page";

export default function Page() {
  return (
    <PlaceholderPage
      title="Lançamentos"
      description="Entradas e saídas de caixa, digitadas à mão ou vindas de importação."
      phase="Fase 2"
      waitingFor="Precisa do CRUD de lançamentos e do plano de contas."
    />
  );
}
