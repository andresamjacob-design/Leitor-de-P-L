import type { ReportName } from "@/lib/export/reports";

/**
 * Download links for the report on screen.
 *
 * They carry the same filters the page is showing, because an export that quietly used a
 * different range would be worse than no export (SPEC §10).
 */
export function ExportLinks({
  slug,
  report,
  from,
  to,
}: {
  slug: string;
  report: ReportName;
  /** `YYYY-MM`. Omit for reports that have no range. */
  from?: string;
  to?: string;
}) {
  const query = new URLSearchParams();
  if (from) query.set("de", from);
  if (to) query.set("ate", to);

  const href = (format: "xlsx" | "csv") => {
    const params = new URLSearchParams(query);
    params.set("formato", format);
    return `/${slug}/export/${report}?${params.toString()}`;
  };

  return (
    <span className="flex items-center gap-3 text-sm">
      <span className="text-xs text-muted">Baixar:</span>
      {/* Plain anchors, not <Link>: these are file downloads, not navigations. */}
      <a href={href("xlsx")} className="text-accent hover:underline" download>
        XLSX
      </a>
      <a href={href("csv")} className="text-accent hover:underline" download>
        CSV
      </a>
    </span>
  );
}
