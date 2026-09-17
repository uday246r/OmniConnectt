import { useEffect, useRef } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import "../drawer/DrawerContent.css";
import { Icon } from "../common/Icon";
import { StatusBadge } from "../common/StatusBadge";
import { RatingStars } from "../common/RatingStars";
import { formatDate, formatFieldValue } from "../../utils/fieldFormat";
import { useProductStore } from "../../stores/useProductStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useShallow } from "zustand/react/shallow";

export function ProductDetailsDrawer({ productId }: { productId: string }) {
  const { items, selectedProduct, selectedLoading, fetchProductById, clearSelectedProduct } = useProductStore(useShallow((s) => ({ items: s.items, selectedProduct: s.selectedProduct, selectedLoading: s.selectedLoading, fetchProductById: s.fetchProductById, clearSelectedProduct: s.clearSelectedProduct })));
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const trackedRef = useRef<string | null>(null);

  const listItem = items.find((i) => i.id === productId);

  useEffect(() => {
    const shouldTrack = trackedRef.current !== productId;
    if (shouldTrack) {
      trackedRef.current = productId;
    }
    fetchProductById(productId, shouldTrack);
    return () => clearSelectedProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const product = selectedProduct;
  const name = product?.name || listItem?.name || "Loading...";
  const categoryName = product?.categoryName || listItem?.categoryName;
  const productTypeName = product?.productTypeName || listItem?.productTypeName;
  const status = product?.status || listItem?.status;
  const iconKey = product?.iconKey || listItem?.iconKey;

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name={(iconKey as never) || "package"} size={20} />}
      title={name}
      subtitle={categoryName && productTypeName ? `${categoryName} · ${productTypeName}` : undefined}
      badge={status && <StatusBadge status={status} entityType="Product" />}
    >
      {selectedLoading && !product ? (
        <div className="pm-skeleton" style={{ height: 200 }} />
      ) : product ? (
        <>
          <DrawerSection title="Overview" icon="info">
            <div className="pm-detail-meta-row">
              <RatingStars rating={product.ratingAverage} count={product.ratingCount} />
              <span className="pm-text-muted">•</span>
              <span>{product.applicationCount.toLocaleString()} applications</span>
              <span className="pm-text-muted">•</span>
              <span>{product.viewCount.toLocaleString()} views</span>
            </div>
            <p className="pm-detail-description">{product.description}</p>
          </DrawerSection>

          {product.promotions.length > 0 && (
            <DrawerSection title="Promotions" icon="tag">
              {product.promotions.map((promo) => (
                <div key={promo.id} className="pm-promo-block">
                  <div className="pm-promo-block-head">
                    <span className="pm-badge pm-badge-warning">{promo.badgeText || "Offer"}</span>
                    <strong>{promo.title}</strong>
                  </div>
                  <p>{promo.offerDetail}</p>
                  <span className="pm-text-muted" style={{ fontSize: 12 }}>
                    Valid till {formatDate(promo.endDate)}
                  </span>
                </div>
              ))}
            </DrawerSection>
          )}

          <DrawerSection title="Key Details" icon="grid">
            <div className="pm-detail-fields">
              {product.detailFields.map((f) => (
                <div key={f.fieldDefinitionId} className="pm-detail-field">
                  <span>{f.label}</span>
                  <strong>{formatFieldValue(f.dataType, f.value, f.unit)}</strong>
                </div>
              ))}
            </div>
          </DrawerSection>

          {product.benefits.length > 0 && (
            <DrawerSection title="Benefits" icon="check">
              <ul className="pm-benefit-list">
                {product.benefits.map((b) => (
                  <li key={b.id}>
                    <Icon name={(b.iconKey as never) || "check"} size={16} />
                    <div>
                      <strong>{b.title}</strong>
                      <p>{b.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}

          {product.eligibilityCriteria.length > 0 && (
            <DrawerSection title="Eligibility Criteria" icon="shield">
              <ul className="pm-eligibility-list">
                {product.eligibilityCriteria.map((e) => (
                  <li key={e.id}>
                    <strong>{e.criteria}</strong>
                    <p>{e.description}</p>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}

          <DrawerSection title={`Customer Reviews (${product.ratingCount})`} icon="star">
            {product.recentReviews.length === 0 ? (
              <p className="pm-text-muted" style={{ fontSize: 13 }}>
                No published reviews yet.
              </p>
            ) : (
              <ul className="pm-review-list">
                {product.recentReviews.map((r) => (
                  <li key={r.id}>
                    <div className="pm-review-list-head">
                      <strong>{r.customerName}</strong>
                      <RatingStars rating={r.rating} />
                    </div>
                    <p>{r.comment}</p>
                    <span className="pm-text-muted" style={{ fontSize: 12 }}>
                      {formatDate(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>
        </>
      ) : null}
    </Drawer>
  );
}
