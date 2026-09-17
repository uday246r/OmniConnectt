import { Drawer, DrawerSection } from "../drawer/Drawer";
import "../drawer/DrawerContent.css";
import { Icon } from "../common/Icon";
import { useSetupStore } from "../../stores/useSetupStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { formatFieldValue } from "../../utils/fieldFormat";
import { useShallow } from "zustand/react/shallow";

export function ProductTypeDetailsDrawer({ productTypeId }: { productTypeId: string }) {
  const { close, open } = useDrawerStore(useShallow((s) => ({ close: s.close, open: s.open })));
  const productTypes = useSetupStore((s) => s.productTypes);
  const productType = productTypes.find((t) => t.id === productTypeId) ?? null;

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name={(productType?.iconKey as never) || "package"} size={20} />}
      title={productType ? productType.name : "Loading..."}
      subtitle={productType ? `Code: ${productType.code} · ${productType.productCount} linked products` : undefined}
    >
      {!productType ? (
        <div className="pm-skeleton" style={{ height: 200 }} />
      ) : (
        <>
          <DrawerSection title="Basic Information" icon="info">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Type Name</span>
                <strong>{productType.name}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Code</span>
                <strong><code>{productType.code}</code></strong>
              </div>
              <div className="pm-detail-field">
                <span>Icon</span>
                <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name={productType.iconKey as never} size={16} />
                  {productType.iconKey}
                </strong>
              </div>
              <div className="pm-detail-field">
                <span>Linked Products</span>
                <strong>{productType.productCount}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Short Label</span>
                <strong>{productType.shortLabel || productType.name}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Apply Button Label</span>
                <strong>{productType.applyButtonLabel || "Apply Now"}</strong>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection
            title={`Custom Fields (${productType.fieldDefinitions?.length ?? 0})`}
            icon="tag"
          >
            {!productType.fieldDefinitions || productType.fieldDefinitions.length === 0 ? (
              <p className="pm-text-muted" style={{ fontSize: 13 }}>No fields configured.</p>
            ) : (
              <div className="pm-table-wrap">
                <table className="pm-table pm-setup-table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Key</th>
                      <th>Type</th>
                      <th>Flags</th>
                      <th>Sample</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productType.fieldDefinitions
                      .slice()
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((f) => (
                        <tr
                          key={f.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => open("field-details", { productTypeId: productType.id, fieldId: f.id })}
                        >
                          <td><strong>{f.label}</strong></td>
                          <td><code>{f.key}</code></td>
                          <td><span className="pm-badge pm-badge-info">{f.dataType}</span></td>
                          <td>
                            <div className="pm-field-flags">
                              {f.required && <span className="pm-badge pm-badge-warning">Required</span>}
                              {f.displayOnCard && <span className="pm-badge pm-badge-success">Card</span>}
                              {f.filterable && <span className="pm-badge pm-badge-neutral">Filter</span>}
                            </div>
                          </td>
                          <td className="pm-text-muted">
                            {formatFieldValue(f.dataType, "0", f.unit) === "0" ? "-" : formatFieldValue(f.dataType, "0", f.unit)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </DrawerSection>
        </>
      )}
    </Drawer>
  );
}
