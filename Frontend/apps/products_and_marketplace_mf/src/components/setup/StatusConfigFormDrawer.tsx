import { isApprovalPending } from "../../services/httpClient";
import { CustomSelect } from "../common/CustomSelect";
import { useEffect, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import type { StatusEntityType, StatusTone } from "../../types/domain";

const TONES: { value: StatusTone; label: string }[] = [
  { value: "success", label: "Green (Success)" },
  { value: "warning", label: "Amber (Warning)" },
  { value: "danger", label: "Red (Danger)" },
  { value: "info", label: "Blue (Info)" },
  { value: "neutral", label: "Gray (Neutral)" },
];

const VALUE_REGEX = /^[A-Za-z][A-Za-z0-9]*$/;

export function StatusConfigFormDrawer({ statusConfigId, entityType }: { statusConfigId?: string; entityType?: StatusEntityType }) {
  const { close } = useDrawerStore();
  const { configs, createConfig, updateConfig } = useStatusConfigStore();
  const existing = statusConfigId ? configs.find((c) => c.id === statusConfigId) : undefined;
  const isCreate = !statusConfigId;
  const effectiveEntityType = existing?.entityType ?? entityType;

  const [value, setValue] = useState("");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [color, setColor] = useState<StatusTone>(existing?.color ?? "neutral");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [sortOrder, setSortOrder] = useState(existing?.sortOrder ?? 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setLabel(existing.label);
    setColor(existing.color);
    setEnabled(existing.enabled);
    setSortOrder(existing.sortOrder);
  }, [existing]);

  useEffect(() => {
    if (!isCreate || !effectiveEntityType) return;
    const count = configs.filter((c) => c.entityType === effectiveEntityType).length;
    setSortOrder(count + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, effectiveEntityType]);

  if (!isCreate && !existing) return null;
  if (!effectiveEntityType) return null;

  async function handleSubmit() {
    if (!label.trim()) {
      setError("Label is required.");
      return;
    }
    if (isCreate && !VALUE_REGEX.test(value.trim())) {
      setError("Status value must start with a letter and contain only letters and numbers (no spaces or symbols).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isCreate) {
        await createConfig({ entityType: effectiveEntityType!, value: value.trim(), label, color, enabled, sortOrder });
      } else {
        await updateConfig(statusConfigId!, { label, color, enabled, sortOrder });
      }
      close();
    } catch (err) {
      if (isApprovalPending(err)) return;
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="settings" size={20} />}
      title={isCreate ? "Add Status" : "Edit Status"}
      subtitle={isCreate ? `New status for ${effectiveEntityType}` : `${existing!.entityType} · underlying value "${existing!.value}"`}
      footer={
        <button className="pm-btn pm-btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Saving..." : isCreate ? "Create Status" : "Save Changes"}
        </button>
      }
    >
      {error && <div className="pm-field-error-banner">{error}</div>}
      <DrawerSection title="Display">
        <div className="pm-form-grid">
          {isCreate ? (
            <div className="pm-field pm-field-full">
              <label>Status Value *</label>
              <input
                className="pm-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. Escalated"
              />
              <span className="pm-hint">Letters and numbers only, no spaces - this is the actual stored value and can't be changed later.</span>
            </div>
          ) : null}
          <div className="pm-field pm-field-full">
            <label>Display Label *</label>
            <input className="pm-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. In Review" />
            <span className="pm-hint">
              {isCreate ? "Shown everywhere this status appears." : `Shown everywhere this status appears. The underlying value ("${existing!.value}") never changes.`}
            </span>
          </div>
          <div className="pm-field">
            <label>Badge Color</label>
            <CustomSelect aria-label="Badge color" options={TONES.map((t) => ({ value: t.value, label: t.label }))} value={color} onChange={(v) => setColor(v as StatusTone)} />
          </div>
          <div className="pm-field">
            <label>Sort Order</label>
            <input className="pm-input" type="number" min={1} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
        </div>
        <div className="pm-mt-4">
          <span className={`pm-badge pm-badge-dot pm-badge-${color}`}>{label || value || "Preview"}</span>
        </div>
      </DrawerSection>
      <DrawerSection title="Availability">
        <div className="pm-checkbox-grid">
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              <strong>Enabled</strong>
              <span className="pm-hint">Offered when creating/editing a {effectiveEntityType.toLowerCase()}. Disabling never affects existing records already set to this status.</span>
            </span>
          </label>
        </div>
      </DrawerSection>
    </Drawer>
  );
}
