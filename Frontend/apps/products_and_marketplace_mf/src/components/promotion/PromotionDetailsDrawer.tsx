import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { StatusBadge } from "../common/StatusBadge";
import { formatDate } from "../../utils/fieldFormat";
import { usePromotionStore } from "../../stores/usePromotionStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useShallow } from "zustand/react/shallow";
import "../drawer/DrawerContent.css";

export function PromotionDetailsDrawer({ promotionId }: { promotionId: string }) {
  const { items } = usePromotionStore(useShallow((s) => ({ items: s.items })));
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const promo = items.find((p) => p.id === promotionId);

  if (!promo) return null;

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="tag" size={20} />}
      title={promo.title}
      subtitle={`${promo.productName} · ${promo.productCategoryName}`}
      badge={<StatusBadge status={promo.status} entityType="Promotion" />}
    >
      <DrawerSection title="Offer Details" icon="tag">
        <p className="pm-detail-description">{promo.offerDetail || promo.description}</p>
      </DrawerSection>
      <DrawerSection title="Validity & Settings" icon="calendar">
        <div className="pm-detail-fields">
          <div className="pm-detail-field">
            <span>Start Date</span>
            <strong>{formatDate(promo.startDate)}</strong>
          </div>
          <div className="pm-detail-field">
            <span>End Date</span>
            <strong>{formatDate(promo.endDate)}</strong>
          </div>
          <div className="pm-detail-field">
            <span>Priority</span>
            <strong>{promo.priority}</strong>
          </div>
          <div className="pm-detail-field">
            <span>Badge</span>
            <strong>{promo.badgeText || "-"}</strong>
          </div>
        </div>
      </DrawerSection>
      {promo.termsAndConditions && (
        <DrawerSection title="Terms & Conditions" icon="file-text">
          <p className="pm-detail-description">{promo.termsAndConditions}</p>
        </DrawerSection>
      )}
    </Drawer>
  );
}
