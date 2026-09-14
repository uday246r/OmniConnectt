import { Drawer, DrawerSection } from "../drawer/Drawer";
import "../drawer/DrawerContent.css";
import { Icon } from "../common/Icon";
import { useSetupStore } from "../../stores/useSetupStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { formatFieldValue } from "../../utils/fieldFormat";

export function FieldDefinitionDetailsDrawer({ productTypeId, fieldId }: { productTypeId: string; fieldId: string }) {
  const { close } = useDrawerStore();
  const productTypes = useSetupStore((s) => s.productTypes);
  const productType = productTypes.find((t) => t.id === productTypeId);
  const field = productType?.fieldDefinitions.find((f) => f.id === fieldId) ?? null;

  const flags = field
    ? [
        field.required && "Required",
        field.filterable && "Filterable",
        field.visibleToCustomer && "Visible to Customer",
        field.sortable && "Sortable",
        field.displayOnCard && "Display on Card",
        field.displayOnDetails && "Display on Details",
        field.displayInApplication && "Display in Application",
        field.isPrimaryMetric && "Primary Metric",
        field.isSecondaryMetric && "Secondary Metric",
      ].filter(Boolean)
    : [];

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="tag" size={20} />}
      title={field ? field.label : "Loading..."}
      subtitle={productType ? `Field on "${productType.name}"` : undefined}
    >
      {!field ? (
        <div className="pm-skeleton" style={{ height: 200 }} />
      ) : (
        <>
          <DrawerSection title="Basic Information" icon="info">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Display Label</span>
                <strong>{field.label}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Field Key</span>
                <strong><code>{field.key}</code></strong>
              </div>
              <div className="pm-detail-field">
                <span>Data Type</span>
                <strong><span className="pm-badge pm-badge-info">{field.dataType}</span></strong>
              </div>
              <div className="pm-detail-field">
                <span>Unit / Suffix</span>
                <strong>{field.unit || "—"}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Sort Order</span>
                <strong>#{field.sortOrder}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Sample Display</span>
                <strong>
                  {formatFieldValue(field.dataType, "0", field.unit) === "0"
                    ? "—"
                    : formatFieldValue(field.dataType, "0", field.unit)}
                </strong>
              </div>
            </div>
          </DrawerSection>

          {field.options && field.options.length > 0 && (
            <DrawerSection title="Options" icon="list">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {field.options.map((opt, i) => (
                  <span key={i} className="pm-badge pm-badge-neutral">{opt}</span>
                ))}
              </div>
            </DrawerSection>
          )}

          <DrawerSection title="Behavior Flags" icon="settings">
            {flags.length === 0 ? (
              <p className="pm-text-muted" style={{ fontSize: 13 }}>No flags enabled.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {flags.map((flag) => (
                  <span key={flag as string} className="pm-badge pm-badge-success">
                    <Icon name="check" size={10} /> {flag}
                  </span>
                ))}
              </div>
            )}
          </DrawerSection>
        </>
      )}
    </Drawer>
  );
}
