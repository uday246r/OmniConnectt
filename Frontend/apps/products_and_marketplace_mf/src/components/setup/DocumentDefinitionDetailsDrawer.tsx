import { Drawer, DrawerSection } from "../drawer/Drawer";
import "../drawer/DrawerContent.css";
import { Icon } from "../common/Icon";
import { useSetupStore } from "../../stores/useSetupStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { formatDate } from "../../utils/fieldFormat";
import { useShallow } from "zustand/react/shallow";

export function DocumentDefinitionDetailsDrawer({ documentId }: { documentId: string }) {
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const documentDefinitions = useSetupStore((s) => s.documentDefinitions);
  const doc = documentDefinitions.find((d) => d.id === documentId) ?? null;

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="file" size={20} />}
      title={doc ? doc.name : "Loading..."}
      subtitle="Document Requirement Details"
    >
      {!doc ? (
        <div className="pm-skeleton" style={{ height: 200 }} />
      ) : (
        <>
          <DrawerSection title="Document Details" icon="info">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Document Name</span>
                <strong>{doc.name}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Category</span>
                <strong>{doc.documentType || "—"}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Applies To</span>
                <strong>{doc.productTypeName ?? "All Product Types"}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Sort Order</span>
                <strong>#{doc.sortOrder}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Created On</span>
                <strong>{formatDate(doc.createdAt)}</strong>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Behavior" icon="settings">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Required</span>
                <strong>
                  {doc.required ? (
                    <span className="pm-badge pm-badge-warning">Required</span>
                  ) : (
                    <span className="pm-badge pm-badge-neutral">Optional</span>
                  )}
                </strong>
              </div>
              <div className="pm-detail-field">
                <span>Status</span>
                <strong>
                  {doc.active ? (
                    <span className="pm-badge pm-badge-success">Active</span>
                  ) : (
                    <span className="pm-badge pm-badge-danger">Inactive</span>
                  )}
                </strong>
              </div>
            </div>
          </DrawerSection>
        </>
      )}
    </Drawer>
  );
}
