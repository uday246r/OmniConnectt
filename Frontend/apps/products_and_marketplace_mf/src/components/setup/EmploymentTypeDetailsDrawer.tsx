import { Drawer, DrawerSection } from "../drawer/Drawer";
import "../drawer/DrawerContent.css";
import { Icon } from "../common/Icon";
import { useEmploymentTypeStore } from "../../stores/useEmploymentTypeStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { formatDate } from "../../utils/fieldFormat";
import { useShallow } from "zustand/react/shallow";

export function EmploymentTypeDetailsDrawer({ employmentTypeId }: { employmentTypeId: string }) {
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const items = useEmploymentTypeStore((s) => s.items);
  const empType = items.find((e) => e.id === employmentTypeId) ?? null;

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="briefcase" size={20} />}
      title={empType ? empType.name : "Loading..."}
      subtitle="Employment Type Details"
    >
      {!empType ? (
        <div className="pm-skeleton" style={{ height: 200 }} />
      ) : (
        <>
          <DrawerSection title="Basic Information" icon="info">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Type Name</span>
                <strong>{empType.name}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Status</span>
                <strong>
                  {empType.active ? (
                    <span className="pm-badge pm-badge-success">Active</span>
                  ) : (
                    <span className="pm-badge pm-badge-neutral">Inactive</span>
                  )}
                </strong>
              </div>
              <div className="pm-detail-field">
                <span>Sort Order</span>
                <strong>#{empType.sortOrder}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Created On</span>
                <strong>{formatDate(empType.createdAt)}</strong>
              </div>
            </div>
          </DrawerSection>
        </>
      )}
    </Drawer>
  );
}
