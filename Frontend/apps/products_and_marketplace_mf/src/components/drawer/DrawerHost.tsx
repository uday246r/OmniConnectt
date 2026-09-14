import { useDrawerStore } from "../../stores/useDrawerStore";
import { ProductDetailsDrawer } from "../product/ProductDetailsDrawer";
import { ApplyNowDrawer } from "../product/ApplyNowDrawer";
import { ProductFormDrawer } from "../product/ProductFormDrawer";
import { CategoryFormDrawer } from "../category/CategoryFormDrawer";
import { CategoryDetailsDrawer } from "../category/CategoryDetailsDrawer";
import { PromotionFormDrawer } from "../promotion/PromotionFormDrawer";
import { PromotionDetailsDrawer } from "../promotion/PromotionDetailsDrawer";
import { ApplicationDetailsDrawer } from "../application/ApplicationDetailsDrawer";
import { AuditLogDetailsDrawer } from "../auditlog/AuditLogDetailsDrawer";
import { ProductTypeFormDrawer } from "../setup/ProductTypeFormDrawer";
import { ProductTypeDetailsDrawer } from "../setup/ProductTypeDetailsDrawer";
import { FieldDefinitionFormDrawer } from "../setup/FieldDefinitionFormDrawer";
import { FieldDefinitionDetailsDrawer } from "../setup/FieldDefinitionDetailsDrawer";
import { DocumentDefinitionFormDrawer } from "../setup/DocumentDefinitionFormDrawer";
import { DocumentDefinitionDetailsDrawer } from "../setup/DocumentDefinitionDetailsDrawer";
import { StatusConfigFormDrawer } from "../setup/StatusConfigFormDrawer";
import { StatusConfigDetailsDrawer } from "../setup/StatusConfigDetailsDrawer";
import { EmploymentTypeFormDrawer } from "../setup/EmploymentTypeFormDrawer";
import { EmploymentTypeDetailsDrawer } from "../setup/EmploymentTypeDetailsDrawer";
import type { StatusEntityType } from "../../types/domain";

export function DrawerHost() {
  const { isOpen, type, payload } = useDrawerStore();
  if (!isOpen || !type) return null;

  switch (type) {
    case "product-details":
      return <ProductDetailsDrawer productId={payload?.productId as string} />;
    case "apply-now":
      return <ApplyNowDrawer productId={payload?.productId as string} />;
    case "product-form":
      return <ProductFormDrawer productId={payload?.productId as string | undefined} />;
    case "category-form":
      return <CategoryFormDrawer categoryId={payload?.categoryId as string | undefined} />;
    case "category-details":
      return <CategoryDetailsDrawer categoryId={payload?.categoryId as string} />;
    case "promotion-form":
      return <PromotionFormDrawer promotionId={payload?.promotionId as string | undefined} />;
    case "promotion-details":
      return <PromotionDetailsDrawer promotionId={payload?.promotionId as string} />;
    case "application-details":
      return <ApplicationDetailsDrawer applicationId={payload?.applicationId as string} />;
    case "audit-log-details":
      return <AuditLogDetailsDrawer auditLogId={payload?.auditLogId as string} />;
    case "product-type-form":
      return <ProductTypeFormDrawer productTypeId={payload?.productTypeId as string | undefined} />;
    case "product-type-details":
      return <ProductTypeDetailsDrawer productTypeId={payload?.productTypeId as string} />;
    case "field-form":
      return <FieldDefinitionFormDrawer productTypeId={payload?.productTypeId as string} fieldId={payload?.fieldId as string | undefined} />;
    case "field-details":
      return <FieldDefinitionDetailsDrawer productTypeId={payload?.productTypeId as string} fieldId={payload?.fieldId as string} />;
    case "document-form":
      return <DocumentDefinitionFormDrawer documentId={payload?.documentId as string | undefined} />;
    case "document-details":
      return <DocumentDefinitionDetailsDrawer documentId={payload?.documentId as string} />;
    case "status-config-form":
      return (
        <StatusConfigFormDrawer
          statusConfigId={payload?.statusConfigId as string | undefined}
          entityType={payload?.entityType as StatusEntityType | undefined}
        />
      );
    case "status-config-details":
      return <StatusConfigDetailsDrawer statusConfigId={payload?.statusConfigId as string} />;
    case "employment-type-form":
      return <EmploymentTypeFormDrawer employmentTypeId={payload?.employmentTypeId as string | undefined} />;
    case "employment-type-details":
      return <EmploymentTypeDetailsDrawer employmentTypeId={payload?.employmentTypeId as string} />;
    default:
      return null;
  }
}

