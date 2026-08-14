import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { InvoiceForm } from "../invoice-form";
import { listClients } from "@/lib/data/clients";
import { listContracts } from "@/lib/data/contracts";
import { getInvoice } from "@/lib/data/invoices";
import { resolveScope } from "@/lib/entities";
import { formatPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const [clients, contracts] = await Promise.all([
    listClients([invoice.entityId], { includeInactive: true }),
    listContracts([invoice.entityId]),
  ]);

  return (
    <>
      <PageHeader
        title={`NF ${invoice.number}${invoice.series ? `/${invoice.series}` : ""}`}
        description={`${formatPeriod(invoice.servicePeriod)} · ${formatMoney(invoice.grossAmount)}`}
      />
      <InvoiceForm slug={slug} invoice={invoice} clients={clients} contracts={contracts} />
    </>
  );
}
