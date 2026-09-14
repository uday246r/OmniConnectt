import { useEffect, useMemo, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { CustomSelect } from "../common/CustomSelect";
import { usePromotionStore } from "../../stores/usePromotionStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import { useToastStore } from "../../stores/useToastStore";
import { productApi } from "../../services/productApi";
import type { ProductListItem, PromotionStatus } from "../../types/domain";

function toInputDate(value?: string) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function PromotionFormDrawer({ promotionId }: { promotionId?: string }) {
  const isEdit = !!promotionId;
  const { close } = useDrawerStore();
  const { items, createPromotion, updatePromotion } = usePromotionStore();
  const statusConfigs = useStatusConfigStore((s) => s.configs);
  const statusOptions = useMemo(
    () => statusConfigs.filter((c) => c.entityType === "Promotion").sort((a, b) => a.sortOrder - b.sortOrder),
    [statusConfigs]
  );
  const existing = items.find((p) => p.id === promotionId);

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [productId, setProductId] = useState(existing?.productId ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [badgeText, setBadgeText] = useState(existing?.badgeText ?? "");
  const [offerDetail, setOfferDetail] = useState(existing?.offerDetail ?? "");
  const [terms, setTerms] = useState(existing?.termsAndConditions ?? "");
  const [startDate, setStartDate] = useState(toInputDate(existing?.startDate) || new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(toInputDate(existing?.endDate) || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [priority, setPriority] = useState(existing?.priority ?? 5);
  const [status, setStatus] = useState<PromotionStatus>(existing?.status ?? "Draft");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    productApi.search({ pageSize: 100 }).then((res) => setProducts(res?.items || []));
  }, []);

  async function handleSubmit() {
    if (!productId || !title.trim()) {
      setError("Please select a product and enter a title.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        productId,
        title,
        description,
        badgeText,
        offerDetail,
        termsAndConditions: terms,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        priority,
        status,
      };
      if (isEdit && promotionId) {
        await updatePromotion(promotionId, input);
        useToastStore.getState().success("Promotion Updated", `"${title}" has been updated successfully.`);
      } else {
        await createPromotion(input);
        useToastStore.getState().success("Promotion Created", `"${title}" has been created successfully.`);
      }
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="tag" size={20} />}
      title={isEdit ? "Edit Promotion" : "Add Promotion"}
      subtitle="Promotions tied to a product appear automatically on its marketplace card while active"
      footer={
        <button className="pm-btn pm-btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Promotion"}
        </button>
      }
    >
      {error && <div className="pm-field-error-banner">{error}</div>}
      <DrawerSection title="Promotion Details">
        <div className="pm-form-grid">
          <div className="pm-field pm-field-full">
            <label>Product *</label>
            <CustomSelect
              options={products.map((p) => ({
                value: p.id,
                label: p.name,
                sublabel: p.categoryName || p.productTypeName,
              }))}
              value={productId}
              onChange={(val) => setProductId(val)}
              placeholder="Select product..."
            />
          </div>
          <div className="pm-field pm-field-full">
            <label>Title *</label>
            <input className="pm-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Zero Joining Fee" />
          </div>
          <div className="pm-field">
            <label>Badge Text</label>
            <input className="pm-input" value={badgeText} onChange={(e) => setBadgeText(e.target.value)} placeholder="e.g. Zero Fee" />
          </div>
          <div className="pm-field">
            <label>Priority (1-10)</label>
            <input className="pm-input" type="number" min={1} max={10} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          </div>
          <div className="pm-field pm-field-full">
            <label>Description</label>
            <textarea className="pm-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="pm-field pm-field-full">
            <label>Offer Detail</label>
            <textarea className="pm-input" rows={2} value={offerDetail} onChange={(e) => setOfferDetail(e.target.value)} placeholder="Shown prominently on product details" />
          </div>
          <div className="pm-field pm-field-full">
            <label>Terms & Conditions</label>
            <textarea className="pm-input" rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          <div className="pm-field">
            <label>Start Date</label>
            <input className="pm-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="pm-field">
            <label>End Date</label>
            <input className="pm-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="pm-field">
            <label>Status</label>
            <CustomSelect
              options={statusOptions.filter((c) => c.value === status || c.enabled).map((c) => ({
                value: c.value,
                label: c.label,
              }))}
              value={status}
              onChange={(val) => setStatus(val as PromotionStatus)}
              placeholder="Select status..."
            />
          </div>
        </div>
      </DrawerSection>
    </Drawer>
  );
}
