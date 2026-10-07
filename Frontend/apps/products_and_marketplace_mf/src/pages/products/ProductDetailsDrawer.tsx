import { useEffect, useState } from 'react';
import { Button, DetailField, DetailGrid, DetailSection, DetailSections, Drawer, EmptyState, Icon, SkeletonDetail, formatDateTime } from '@omniconnect/ui';
import { CatalogIcon } from '../../components/CatalogIcon';
import { StatusBadge } from '../../components/StatusBadge';
import { productApi } from '../../services/productApi';
import { useStatus } from '../../stores/useStatusConfigStore';
import { formatFieldValue } from '../../utils/format';
import type { ProductDetail } from '../../types/domain';
import styles from './products.module.css';

export interface ProductDetailsDrawerProps {
  /** The product to show, or null when closed. */
  productId: string | null;
  onClose: () => void;
  /** Omit when the person may not edit. */
  onEdit?: (product: ProductDetail) => void;
}

/**
 * Everything about one product: where it sits, every attribute marked for the details view, its benefits
 * and its eligibility. Opening it counts as a view of the product.
 */
export function ProductDetailsDrawer({ productId, onClose, onEdit }: ProductDetailsDrawerProps) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const own = useStatus('Product', product?.status ?? '');

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProduct(null);
    productApi
      .get(productId, { trackView: true })
      .then((detail) => !cancelled && setProduct(detail))
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [productId, attempt]);

  return (
    <Drawer
      open={productId !== null}
      onClose={onClose}
      width="560px"
      title={product?.name ?? 'Product details'}
      subtitle={product ? `${product.categoryName} › ${product.subCategoryName}` : undefined}
      icon={<CatalogIcon iconKey={product?.iconKey} size="sm" />}
      footer={product && onEdit ? <Button onClick={() => onEdit(product)} leadingIcon={<Icon.Pencil />}>Edit product</Button> : undefined}
    >
      {error ? (
        <EmptyState title="Could not load this product" description={error} action={<Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>} />
      ) : loading || !product ? (
        <SkeletonDetail sections={3} fieldsPerSection={4} />
      ) : (
        <DetailSections>
          <DetailSection title="Overview">
            <DetailGrid>
              <DetailField label="Status"><StatusBadge entityType="Product" value={product.status} /></DetailField>
              <DetailField label="Shown in the catalogue">{product.isVisible ? 'Yes' : own.isLive ? 'No — its category or sub-category is not live' : 'No — its status is not live'}</DetailField>
              <DetailField label="Code" mono>{product.code}</DetailField>
              <DetailField label="Sub-category code" mono>{product.subCategoryCode}</DetailField>
              <DetailField label="Added">{formatDateTime(product.createdAt)}</DetailField>
              <DetailField label="Last changed">{formatDateTime(product.updatedAt)}</DetailField>
              <DetailField label="Times viewed">{product.viewCount}</DetailField>
              <DetailField label="Description" full>{product.description || product.shortDescription}</DetailField>
            </DetailGrid>
          </DetailSection>

          {product.detailFields.length > 0 && (
            <DetailSection title="Details">
              <DetailGrid>
                {product.detailFields.map((field) => (
                  <DetailField key={field.fieldDefinitionId} label={field.label}>{formatFieldValue(field)}</DetailField>
                ))}
              </DetailGrid>
            </DetailSection>
          )}

          {product.benefits.length > 0 && (
            <DetailSection title="Benefits">
              <ul className={styles.tags}>
                {product.benefits.map((benefit) => (
                  <li key={benefit.id} className={styles.tag} title={benefit.description || undefined}><Icon.Check /> {benefit.title}</li>
                ))}
              </ul>
            </DetailSection>
          )}

          {product.eligibilityCriteria.length > 0 && (
            <DetailSection title="Eligibility">
              <DetailGrid>
                {product.eligibilityCriteria.map((item) => (
                  <DetailField key={item.id} label={item.criteria} full>{item.description}</DetailField>
                ))}
              </DetailGrid>
            </DetailSection>
          )}
        </DetailSections>
      )}
    </Drawer>
  );
}
