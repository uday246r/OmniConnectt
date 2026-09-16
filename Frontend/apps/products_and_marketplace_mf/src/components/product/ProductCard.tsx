import { Icon } from "../common/Icon";
import { StatusBadge } from "../common/StatusBadge";
import { formatFieldValue, formatDate } from "../../utils/fieldFormat";
import type { ProductListItem } from "../../types/domain";
import "./ProductCard.css";

const SORT_BADGE: Record<string, { label: string; tone: string }> = {
  recommended: { label: "Recommended", tone: "pm-badge-info" },
  trending: { label: "Trending", tone: "pm-badge-success" },
  "lowest-rate": { label: "Lowest Rate", tone: "pm-badge-info" },
  "newly-added": { label: "New", tone: "pm-badge-neutral" },
  "top-rated": { label: "Top Rated", tone: "pm-badge-warning" },
  "most-applied": { label: "Most Applied", tone: "pm-badge-warning" },
};

export function ProductCard({
  product,
  onViewDetails,
  onApply,
  onMenuAction,
  canApply,
  canManage,
  sortContext,
}: {
  product: ProductListItem;
  onViewDetails: () => void;
  onApply: () => void;
  onMenuAction?: (action: "edit" | "activate" | "deactivate" | "delete") => void;
  canApply: boolean;
  canManage: boolean;
  /** Currently active marketplace sort tab - shown as the card's top-left badge for Active products. */
  sortContext?: string;
}) {
  const applyLabel = product.applyButtonLabel || "Apply Now";
  const typeBadgeLabel = product.productTypeShortLabel || product.productTypeName;
  const [primary, secondary] = product.cardFields;
  const contextBadge = sortContext ? SORT_BADGE[sortContext] : undefined;

  return (
    <div className="pm-product-card pm-card">
      <div className="pm-product-card-top">
        {product.status === "Active" && contextBadge ? (
          <span className={`pm-badge pm-badge-dot ${contextBadge.tone}`}>{contextBadge.label}</span>
        ) : (
          <StatusBadge status={product.status} entityType="Product" />
        )}
        <span className="pm-badge pm-badge-neutral">{typeBadgeLabel}</span>
      </div>

      {product.activePromotion && (
        <div className="pm-product-promo-strip">
          <span className="pm-product-promo-icon">
            <Icon name="tag" size={11} />
          </span>
          <span className="pm-product-promo-text">{product.activePromotion.badgeText || product.activePromotion.title}</span>
        </div>
      )}

      <div className="pm-product-card-head">
        <div className="pm-product-icon">
          <Icon name={(product.iconKey as never) || "package"} size={22} />
        </div>
        <div>
          <h3 className="pm-product-name">{product.name}</h3>
          <p className="pm-product-desc">{product.shortDescription}</p>
        </div>
      </div>

      <div className="pm-product-meta-row">
        <span className="pm-product-applied">{product.applicationCount.toLocaleString()} Applied</span>
      </div>

      <div className="pm-product-metrics">
        {primary && (
          <div className="pm-product-metric">
            <span className="pm-metric-label">{primary.label}</span>
            <span className="pm-metric-value">{formatFieldValue(primary.dataType, primary.value, primary.unit)}</span>
          </div>
        )}
        {secondary && (
          <div className="pm-product-metric">
            <span className="pm-metric-label">{secondary.label}</span>
            <span className="pm-metric-value">{formatFieldValue(secondary.dataType, secondary.value, secondary.unit)}</span>
          </div>
        )}
      </div>

      {product.featureTags.length > 0 && (
        <div className="pm-product-tags">
          {product.featureTags.map((tag) => (
            <span key={tag} className="pm-product-tag">
              <Icon name="check" size={12} />
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="pm-product-actions">
        <button className="pm-btn pm-btn-outline pm-flex-1" onClick={onViewDetails}>
          View Details
        </button>
        {canApply && (
          <button className="pm-btn pm-btn-primary pm-flex-1" onClick={onApply} disabled={product.status !== "Active"}>
            {applyLabel}
          </button>
        )}
      </div>

      <div className="pm-product-footer">
        <span className="pm-product-updated">Updated {formatDate(product.updatedAt)}</span>
        {canManage && (
          <div className="pm-product-menu">
            <button
              className="pm-icon-btn pm-icon-btn-edit"
              onClick={(e) => {
                e.stopPropagation();
                onMenuAction?.("edit");
              }}
              title="Edit product"
              aria-label="Edit product"
            >
              <Icon name="edit" size={14} />
            </button>
            <button
              className="pm-icon-btn pm-icon-btn-view"
              onClick={(e) => {
                e.stopPropagation();
                onViewDetails();
              }}
              title="View product details"
              aria-label="View product details"
            >
              <Icon name="eye" size={14} />
            </button>
            <button
              className="pm-icon-btn pm-icon-btn-delete"
              onClick={(e) => {
                e.stopPropagation();
                onMenuAction?.("delete");
              }}
              title="Delete product"
              aria-label="Delete product"
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

