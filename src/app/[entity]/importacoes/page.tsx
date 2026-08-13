import { PlaceholderPage } from "@/components/placeholder-page";

export default function Page() {
  return (
    <PlaceholderPage
      title="Importações"
      description="Extrato do Itaú em XLSX/CSV e fatura do cartão em PDF."
      phase="Fase 3"
      waitingFor="Precisa dos parsers e da tela de revisão."
    />
  );
}
