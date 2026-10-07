import { Button, Icon, SkeletonBlock } from '@omniconnect/ui';
import { CatalogIcon } from '../../components/CatalogIcon';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu';
import { StatusBadge } from '../../components/StatusBadge';
import { useStatus } from '../../stores/useStatusConfigStore';
import { formatFieldValue } from '../../utils/format';
import type { ProductListItem } from '../../types/domain';
import styles from './products.module.css';

/** How many benefit tags fit on a card before the rest collapse into "+N". A layout choice, so it lives with the layout. */
const MAX_TAGS_SHOWN = 3;

export interface ProductCardProps {
  product: ProductListItem;
  onView: () => void;
  /** Omit when the person may not edit. */
  onEdit?: () => void;
  menu: RowMenuItem[];
}

/**
 * One product on the catalogue grid: what it is, where it sits, its headline attributes and its benefits.
 *
 * What appears as an attribute row is whatever the sub-category's definitions marked for the card — this
 * component knows no attribute by name. A product hidden by something above it says so, so an
 * administrator who cannot find it on the customer view knows why.
 */
export function ProductCard({ product, onView, onEdit, menu }: ProductCardProps) {
  const own = useStatus('Product', product.status);
  // Its own status is live, yet it is not shown: a category or sub-category above it is what hides it.
  const hiddenFromAbove = !product.isVisible && own.isLive;
  const tags = product.featureTags.slice(0, MAX_TAGS_SHOWN);
  const moreTags = product.featureTags.length - tags.length;

  return (
    <article className={styles.card} data-hidden={!product.isVisible} aria-label={product.name}>
      <header className={styles.head}>
        <CatalogIcon iconKey={product.iconKey} />
        <div className={styles.titles}>
          <h3 className={styles.name}>{product.name}</h3>
          <p className={styles.crumb}>{product.categoryName} › {product.subCategoryName}</p>
        </div>
        <StatusBadge entityType="Product" value={product.status} />
      </header>

      {hiddenFromAbove && (
        <p className={styles.hiddenNote} role="note">
          <Icon.EyeOff /> Hidden — its category or sub-category is not live.
        </p>
      )}

      {product.shortDescription && <p className={styles.short}>{product.shortDescription}</p>}

      {product.cardFields.length > 0 && (
        <dl className={styles.metrics}>
          {product.cardFields.map((field) => (
            <div key={field.fieldDefinitionId} className={styles.metric}>
              <dt>{field.label}</dt>
              <dd>{formatFieldValue(field)}</dd>
            </div>
          ))}
        </dl>
      )}

      {tags.length > 0 && (
        <ul className={styles.tags} aria-label="Benefits">
          {tags.map((tag) => (
            <li key={tag} className={styles.tag}><Icon.Check /> {tag}</li>
          ))}
          {moreTags > 0 && <li className={`${styles.tag} ${styles.tagMore}`}>+{moreTags}</li>}
        </ul>
      )}

      <div className={`${styles.actions} ${onEdit ? '' : styles.actionsSingle}`}>
        <Button variant="secondary" onClick={onView}>View details</Button>
        {onEdit && <Button onClick={onEdit} leadingIcon={<Icon.Pencil />}>Edit</Button>}
      </div>

      <footer className={styles.foot}>
        <span className={styles.code}>Code: {product.code}</span>
        {menu.length > 0 && <RowMenu label={`More actions for ${product.name}`} items={menu} />}
      </footer>
    </article>
  );
}

/**
 * A product card that has not loaded yet.
 *
 * The same card with every part replaced by a placeholder in the place it will occupy: the icon tile
 * and two title lines, the status pill, a description, the attribute panel, the benefit tags, the two
 * buttons and the code. The grid used to show six blank grey slabs instead, which said "something is
 * loading" without saying what; this says "product cards are loading", and the grid does not reflow
 * when they arrive.
 */
export function ProductCardSkeleton() {
  return (
    <div className={`${styles.card} ${styles.cardSkeleton}`} aria-hidden="true">
      <div className={styles.head}>
        <SkeletonBlock width={40} height={40} radius="var(--omni-radius-lg-minus)" className={styles.fixed} />
        <div className={styles.titles}>
          <SkeletonBlock width="68%" height={14} radius="4px" />
          <SkeletonBlock width="46%" height={10} radius="4px" />
        </div>
        <SkeletonBlock width={58} height={22} radius="var(--omni-radius-pill)" className={styles.fixed} />
      </div>

      <div className={styles.skeletonLines}>
        <SkeletonBlock width="100%" height={11} radius="4px" />
        <SkeletonBlock width="74%" height={11} radius="4px" />
      </div>

      <div className={styles.metrics}>
        {['52%', '40%', '46%'].map((w, i) => (
          <div key={i} className={styles.metric}>
            <SkeletonBlock width={w} height={11} radius="4px" />
            <SkeletonBlock width={54} height={11} radius="4px" className={styles.fixed} />
          </div>
        ))}
      </div>

      <div className={styles.tags}>
        <SkeletonBlock width={84} height={22} radius="var(--omni-radius-sm)" />
        <SkeletonBlock width={66} height={22} radius="var(--omni-radius-sm)" />
        <SkeletonBlock width={92} height={22} radius="var(--omni-radius-sm)" />
      </div>

      <div className={styles.actions}>
        <SkeletonBlock width="100%" height={38} radius="var(--omni-radius-lg-minus)" />
        <SkeletonBlock width="100%" height={38} radius="var(--omni-radius-lg-minus)" />
      </div>

      <div className={styles.foot}>
        <SkeletonBlock width={96} height={10} radius="4px" />
      </div>
    </div>
  );
}
