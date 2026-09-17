import { Drawer, DrawerSection } from "../drawer/Drawer";
import "../drawer/DrawerContent.css";
import { Icon } from "../common/Icon";
import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useShallow } from "zustand/react/shallow";

export function StatusConfigDetailsDrawer({ statusConfigId }: { statusConfigId: string }) {
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const configs = useStatusConfigStore((s) => s.configs);
  const config = configs.find((c) => c.id === statusConfigId) ?? null;

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="settings" size={20} />}
      title={config ? config.label : "Loading..."}
      subtitle={config ? `${config.entityType} Status · value "${config.value}"` : undefined}
    >
      {!config ? (
        <div className="pm-skeleton" style={{ height: 200 }} />
      ) : (
        <>
          <DrawerSection title="Display" icon="info">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Entity Type</span>
                <strong>{config.entityType}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Status Value</span>
                <strong><code>{config.value}</code></strong>
              </div>
              <div className="pm-detail-field">
                <span>Display Label</span>
                <strong>{config.label}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Badge Color</span>
                <strong style={{ textTransform: "capitalize" }}>{config.color}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Sort Order</span>
                <strong>#{config.sortOrder}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Availability</span>
                <strong>
                  {config.enabled ? (
                    <span className="pm-badge pm-badge-success">Enabled</span>
                  ) : (
                    <span className="pm-badge pm-badge-neutral">Disabled</span>
                  )}
                </strong>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Badge Preview" icon="tag">
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className={`pm-badge pm-badge-dot pm-badge-${config.color}`}>{config.label}</span>
              <span className={`pm-badge pm-badge-${config.color}`}>{config.label}</span>
            </div>
          </DrawerSection>
        </>
      )}
    </Drawer>
  );
}
