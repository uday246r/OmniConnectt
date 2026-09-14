import { Icon } from "./Icon";

export function Pagination({
  page,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  itemLabel = "items",
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}) {
  if (totalCount === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  const pages: (number | "ellipsis")[] = [];
  const maxButtons = 5;
  if (totalPages <= maxButtons + 1) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("ellipsis");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("ellipsis");
    pages.push(totalPages);
  }

  return (
    <div className="pm-pagination">
      <span className="pm-pagination-info">
        Showing {start} to {end} of {totalCount} {itemLabel}
      </span>
      <div className="pm-pagination-pages">
        <button className="pm-page-btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <Icon name="chevron-left" size={14} />
        </button>
        {pages.map((p, idx) =>
          p === "ellipsis" ? (
            <span key={`e-${idx}`} className="pm-text-muted" style={{ padding: "0 4px" }}>
              …
            </span>
          ) : (
            <button key={p} className={`pm-page-btn ${p === page ? "active" : ""}`} onClick={() => onPageChange(p)}>
              {p}
            </button>
          )
        )}
        <button className="pm-page-btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
    </div>
  );
}
