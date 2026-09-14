import { useEffect, useMemo, useRef, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { FormField, inputClass } from "../common/FormField";
import { PhoneInput, type PhoneValue } from "../common/PhoneInput";
import { CustomSelect } from "../common/CustomSelect";
import { useProductStore } from "../../stores/useProductStore";
import { useApplicationStore } from "../../stores/useApplicationStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useEmploymentTypeStore } from "../../stores/useEmploymentTypeStore";
import { useToastStore } from "../../stores/useToastStore";
import { documentDefinitionApi } from "../../services/documentDefinitionApi";
import { applicationApi } from "../../services/applicationApi";
import { COUNTRIES, DEFAULT_COUNTRY, type Country } from "../../data/countries";
import { validateDob, validateEmail, validateName, validatePhone, validateProductField } from "../../utils/validation";
import { ACCEPT_ATTR, formatFileSize, validateFile } from "../../utils/fileValidation";
import { formatFieldValue } from "../../utils/fieldFormat";
import type { ApplicationDetail, ApplicationFieldValueInput, DocumentDefinition, FieldDefinition } from "../../types/domain";
import { DocumentPreviewModal } from "../common/DocumentPreviewModal";
import "../drawer/DrawerContent.css";
import "./ApplyNowDrawer.css";

const STEPS = ["Personal Information", "Product Details", "Documents", "Review & Submit"];
const TODAY = new Date().toISOString().slice(0, 10);

interface DocFileState {
  file: File | null;
  error: string | null;
}

type UploadStatus = "pending" | "success" | "error";

export function formatFieldLabel(label: string): string {
  if (!label) return "";
  if (label.includes("_")) {
    return label
      .split("_")
      .map((word) => {
        if (word.toUpperCase() === "CIBIL") return "CIBIL";
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ");
  }
  return label;
}

function DynamicField({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldDefinition;
  value: string;
  error?: string | null;
  onChange: (v: string) => void;
}) {
  if (field.isReadOnly) {
    const formattedVal = formatFieldValue(field.dataType, value, field.unit ?? undefined) || value || "N/A";
    return (
      <div className="pm-readonly-field">
        <span className="pm-readonly-value">{formattedVal}</span>
        <span className="pm-readonly-lock-badge" title="Read-only product detail">
          <Icon name="lock" size={12} />
          <span>Locked</span>
        </span>
      </div>
    );
  }

  switch (field.dataType) {
    case "Boolean":
      return (
        <CustomSelect
          options={[
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]}
          value={value === "true" || value === "false" ? value : ""}
          onChange={onChange}
          error={!!error}
          placeholder="Select Yes / No..."
        />
      );
    case "Date":
      return <input type="date" className={inputClass("pm-input", error)} value={value} max={TODAY} onChange={(e) => onChange(e.target.value)} />;
    case "Dropdown":
      return (
        <CustomSelect
          options={field.options ?? []}
          value={value}
          onChange={onChange}
          error={!!error}
          placeholder="Select option..."
        />
      );
    case "MultiSelect": {
      const selected = value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
      const toggle = (opt: string) => {
        const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
        onChange(next.join(","));
      };
      return (
        <div className="pm-multiselect">
          {(field.options ?? []).map((o) => (
            <label key={o} className="pm-checkbox">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "Number":
    case "Currency":
    case "Percentage":
      return (
        <input
          className={inputClass("pm-input", error)}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        />
      );
    default:
      return <input className={inputClass("pm-input", error)} type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}


export function ApplyNowDrawer({ productId }: { productId: string }) {
  const { selectedProduct, selectedLoading, fetchProductById, clearSelectedProduct, productTypes, fetchProductTypes } = useProductStore();
  const { createApplication } = useApplicationStore();
  const { close } = useDrawerStore();
  const { items: employmentTypes, fetchAll: fetchEmploymentTypes } = useEmploymentTypeStore();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdApplication, setCreatedApplication] = useState<ApplicationDetail | null>(null);
  const [docUploadStatus, setDocUploadStatus] = useState<Record<string, UploadStatus>>({});

  const [personal, setPersonal] = useState({ name: "", email: "" });
  const [phone, setPhone] = useState<PhoneValue>({ iso2: DEFAULT_COUNTRY.iso2, localNumber: "" });
  const [dob, setDob] = useState("");
  const [employmentType, setEmploymentType] = useState("Salaried");
  const [dynamicValues, setDynamicValues] = useState<Record<string, string>>({});
  const [requiredDocs, setRequiredDocs] = useState<DocumentDefinition[]>([]);
  const [docState, setDocState] = useState<Record<string, DocFileState>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [previewModal, setPreviewModal] = useState<{ url: string; title: string; fileName: string } | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchEmploymentTypes();
    fetchProductTypes();
  }, [fetchEmploymentTypes, fetchProductTypes]);

  const activeEmploymentTypes = useMemo(
    () => employmentTypes.filter((e) => e.active).sort((a, b) => a.sortOrder - b.sortOrder),
    [employmentTypes]
  );

  useEffect(() => {
    if (activeEmploymentTypes.length > 0 && !activeEmploymentTypes.some((e) => e.name === employmentType)) {
      setEmploymentType(activeEmploymentTypes[0].name);
    }
  }, [activeEmploymentTypes, employmentType]);

  useEffect(() => {
    fetchProductById(productId, false);
    return () => clearSelectedProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    if (!selectedProduct) return;
    documentDefinitionApi.list(selectedProduct.productTypeId).then((docs) => {
      setRequiredDocs(docs);
    });
  }, [selectedProduct]);

  const applicationFields = useMemo(() => {
    const type = productTypes.find((t) => t.id === selectedProduct?.productTypeId);
    return (type?.fieldDefinitions ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }, [productTypes, selectedProduct]);

  useEffect(() => {
    if (!selectedProduct) return;
    const defaults: Record<string, string> = {};
    for (const f of applicationFields) {
      const existing = selectedProduct.detailFields.find((v) => v.fieldDefinitionId === f.id);
      let value = existing?.value ?? "";
      if ((f.dataType === "Number" || f.dataType === "Currency" || f.dataType === "Percentage") && value) {
        value = value.replace(/[^\d.]/g, "");
      }
      defaults[f.id] = value;
    }
    setDynamicValues(defaults);
  }, [applicationFields, selectedProduct]);

  const applyLabel = selectedProduct?.applyButtonLabel || "Apply Now";

  const selectedCountry = COUNTRIES.find((c: Country) => c.iso2 === phone.iso2) ?? DEFAULT_COUNTRY;

  // --- Validation (per step) ---
  const nameError = validateName(personal.name);
  const emailError = validateEmail(personal.email);
  const phoneError = validatePhone(selectedCountry, phone.localNumber);
  const dobError = validateDob(dob);
  const personalErrors = { name: nameError, email: emailError, phone: phoneError, dob: dobError };
  const hasPersonalErrors = Object.values(personalErrors).some(Boolean);

  const dynamicFieldErrors = useMemo(
    () => Object.fromEntries(applicationFields.map((f) => [f.id, validateProductField(f, dynamicValues[f.id] ?? "")])),
    [applicationFields, dynamicValues]
  );
  const hasProductErrors = Object.values(dynamicFieldErrors).some(Boolean);

  const hasDocumentErrors = requiredDocs.some((d) => {
    const state = docState[d.id];
    if (d.required) return !state?.file || !!state?.error;
    return !!state?.error;
  });

  function markTouched(...fields: string[]) {
    setTouched((t) => {
      const next = { ...t };
      for (const f of fields) next[f] = true;
      return next;
    });
  }

  function markAllStepTouched() {
    if (step === 0) markTouched("name", "email", "phone", "dob");
    if (step === 1) markTouched(...applicationFields.map((f) => f.id));
    if (step === 2) markTouched(...requiredDocs.map((d) => `doc-${d.id}`));
  }

  function handleContinue() {
    markAllStepTouched();
    const blocked = step === 0 ? hasPersonalErrors : step === 1 ? hasProductErrors : hasDocumentErrors;
    if (blocked) return;
    setStep((s) => s + 1);
  }

  function handleFileSelected(doc: DocumentDefinition, file: File | undefined) {
    if (!file) return;
    const fileError = validateFile(file);
    setDocState((s) => ({ ...s, [doc.id]: { file, error: fileError } }));
    markTouched(`doc-${doc.id}`);
  }

  function handleRemoveFile(docId: string) {
    setDocState((s) => ({ ...s, [docId]: { file: null, error: null } }));
    const input = fileInputRefs.current[docId];
    if (input) input.value = "";
  }

  function handlePreviewFile(docId: string, docName?: string) {
    const file = docState[docId]?.file;
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewModal({ url, title: docName || file.name, fileName: file.name });
  }

  async function retryUpload(def: DocumentDefinition, applicationId: string, applicationDocumentId: string) {
    const file = docState[def.id]?.file;
    if (!file) return;
    setDocUploadStatus((s) => ({ ...s, [def.id]: "pending" }));
    try {
      await applicationApi.uploadDocument(applicationId, applicationDocumentId, file);
      setDocUploadStatus((s) => ({ ...s, [def.id]: "success" }));
    } catch {
      setDocUploadStatus((s) => ({ ...s, [def.id]: "error" }));
    }
  }

  async function handleSubmit() {
    markAllStepTouched();
    if (hasPersonalErrors || hasProductErrors || hasDocumentErrors) {
      setError("Please fix the highlighted errors before submitting.");
      setStep(hasPersonalErrors ? 0 : hasProductErrors ? 1 : 2);
      return;
    }
    if (!selectedProduct) return;
    setSubmitting(true);
    setError(null);
    try {
      const fieldValues: ApplicationFieldValueInput[] = [
        { fieldKey: "employment_type", fieldLabel: "Employment Type", value: employmentType },
        ...applicationFields.map((f) => ({ fieldDefinitionId: f.id, fieldKey: f.key, fieldLabel: f.label, value: dynamicValues[f.id] ?? "" })),
      ];
      const requiredDocuments = requiredDocs.map((d) => d.name);
      const result = await createApplication({
        productId: selectedProduct.id,
        customerName: personal.name.trim(),
        customerEmail: personal.email.trim(),
        customerPhone: `+${selectedCountry.dialCode}${phone.localNumber}`,
        customerDateOfBirth: dob,
        fieldValues,
        requiredDocuments,
        submit: true,
      });
      setCreatedApplication(result);

      const uploadTargets = requiredDocs
        .map((def) => ({ def, file: docState[def.id]?.file, match: result.documents.find((d) => d.documentName === def.name) }))
        .filter((t): t is { def: DocumentDefinition; file: File; match: NonNullable<typeof t.match> } => !!t.file && !!t.match);

      setDocUploadStatus(Object.fromEntries(uploadTargets.map((t) => [t.def.id, "pending" as UploadStatus])));
      await Promise.all(
        uploadTargets.map(async (t) => {
          try {
            await applicationApi.uploadDocument(result.id, t.match.id, t.file);
            setDocUploadStatus((s) => ({ ...s, [t.def.id]: "success" }));
          } catch {
            setDocUploadStatus((s) => ({ ...s, [t.def.id]: "error" }));
          }
        })
      );
      useToastStore.getState().success("Application Submitted!", `Reference #${result.applicationNumber}`);
    } catch (err) {
      setError((err as Error).message);
      useToastStore.getState().danger("Submission Failed", (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (createdApplication) {
    const uploadedDocs = requiredDocs.filter((d) => docState[d.id]?.file);
    return (
      <Drawer isOpen onClose={close} title="Application Submitted" width={480}>
        <div className="pm-apply-success">
          <div className="pm-apply-success-icon">
            <Icon name="check" size={28} />
          </div>
          <h3>Your application has been submitted!</h3>
          <p>
            Application number <strong>{createdApplication.applicationNumber}</strong> for <strong>{selectedProduct?.name}</strong> has been received.
          </p>
          {uploadedDocs.length > 0 && (
            <div className="pm-doc-upload-summary">
              {uploadedDocs.map((def) => {
                const match = createdApplication.documents.find((d) => d.documentName === def.name);
                const status = docUploadStatus[def.id];
                return (
                  <div key={def.id} className="pm-doc-upload-summary-row">
                    <span>{def.name}</span>
                    {status === "success" && <span className="pm-badge pm-badge-success">Uploaded</span>}
                    {status === "pending" && <span className="pm-badge pm-badge-neutral">Uploading...</span>}
                    {status === "error" && (
                      <span className="pm-row-actions">
                        <span className="pm-badge pm-badge-danger">Failed</span>
                        {match && (
                          <button className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => retryUpload(def, createdApplication.id, match.id)}>
                            Retry
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name={(selectedProduct?.iconKey as never) || "package"} size={20} />}
      title={selectedProduct ? `${applyLabel}: ${selectedProduct.name}` : "Loading..."}
      subtitle={selectedProduct ? `Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}` : undefined}
      footer={
        <>
          {step > 0 && (
            <button className="pm-btn pm-btn-outline" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              className="pm-btn pm-btn-primary"
              onClick={handleContinue}
            >
              Continue
            </button>
          ) : (
            <button className="pm-btn pm-btn-primary" disabled={submitting} onClick={handleSubmit}>
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
          )}
        </>
      }
    >
      {selectedLoading || !selectedProduct ? (
        <div className="pm-skeleton" style={{ height: 200 }} />
      ) : (
        <>
          <div className="pm-apply-steps-wrapper">
            <div className="pm-apply-steps">
              {STEPS.map((s, i) => (
                <div key={s} className={`pm-apply-step ${i === step ? "active" : i < step ? "done" : ""}`}>
                  <span className="pm-apply-step-dot">{i < step ? <Icon name="check" size={11} /> : i + 1}</span>
                  {s}
                </div>
              ))}
            </div>
          </div>

          {error && <div className="pm-field-error-banner">{error}</div>}

          {step === 0 && (
            <DrawerSection title="Your Details" icon="user">
              <div className="pm-form-grid">
                <FormField label="Full Name" required error={touched.name ? nameError : null}>
                  <input
                    className={inputClass("pm-input", touched.name ? nameError : null)}
                    value={personal.name}
                    onBlur={() => markTouched("name")}
                    onChange={(e) => setPersonal({ ...personal, name: e.target.value })}
                  />
                </FormField>
                <FormField label="Email Address" required error={touched.email ? emailError : null}>
                  <input
                    className={inputClass("pm-input", touched.email ? emailError : null)}
                    type="email"
                    value={personal.email}
                    onBlur={() => markTouched("email")}
                    onChange={(e) => setPersonal({ ...personal, email: e.target.value })}
                  />
                </FormField>
                <FormField label="Phone Number" required error={touched.phone ? phoneError : null}>
                  <PhoneInput value={phone} onChange={(v: PhoneValue) => { setPhone(v); markTouched("phone"); }} error={touched.phone ? phoneError : null} />
                </FormField>
                <FormField label="Date of Birth" required error={touched.dob ? dobError : null}>
                  <input
                    type="date"
                    className={inputClass("pm-input", touched.dob ? dobError : null)}
                    value={dob}
                    max={TODAY}
                    onBlur={() => markTouched("dob")}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </FormField>
              </div>
            </DrawerSection>
          )}

          {step === 1 && (
            <DrawerSection title="Product-Specific Information" icon="grid">
              <div className="pm-form-grid">
                <FormField label="Employment Type">
                  <CustomSelect
                    options={activeEmploymentTypes.map((t) => t.name)}
                    value={employmentType}
                    onChange={(val) => setEmploymentType(val)}
                  />
                </FormField>
                {applicationFields.map((f) => (
                  <FormField key={f.id} label={formatFieldLabel(f.label)} required={f.required} error={touched[f.id] ? dynamicFieldErrors[f.id] : null}>
                    <DynamicField
                      field={f}
                      value={dynamicValues[f.id] ?? ""}
                      error={touched[f.id] ? dynamicFieldErrors[f.id] : null}
                      onChange={(v) => {
                        setDynamicValues({ ...dynamicValues, [f.id]: v });
                        markTouched(f.id);
                      }}
                    />
                  </FormField>
                ))}
              </div>
            </DrawerSection>
          )}

          {step === 2 && (
            <DrawerSection title="Required Documents" icon="file">
              {requiredDocs.length === 0 ? (
                <p className="pm-hint">No documents are required for this product.</p>
              ) : (
                <div className="pm-doc-upload-list">
                  {requiredDocs.map((doc) => {
                    const state = docState[doc.id];
                    const showError = touched[`doc-${doc.id}`] ? state?.error ?? (doc.required && !state?.file ? "This document is required." : null) : null;
                    return (
                      <div className="pm-doc-upload-card" key={doc.id}>
                        <div className="pm-doc-upload-head">
                          <span className="pm-doc-list-name">
                            <Icon name="file" size={16} />
                            {doc.name}
                            {doc.required && <span className="pm-badge pm-badge-warning">Required</span>}
                          </span>
                          {state?.file && !state.error && <span className="pm-badge pm-badge-success">Selected</span>}
                          {state?.error && <span className="pm-badge pm-badge-danger">Invalid</span>}
                        </div>

                        {state?.file ? (
                          <div className="pm-doc-upload-file-row">
                            <span className="pm-doc-upload-filename">
                              {state.file.name} · {formatFileSize(state.file.size)}
                            </span>
                            <div className="pm-row-actions">
                              <button type="button" className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => handlePreviewFile(doc.id, doc.name)}>
                                <Icon name="eye" size={14} /> Preview
                              </button>
                              <button type="button" className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => fileInputRefs.current[doc.id]?.click()}>
                                <Icon name="upload" size={14} /> Replace
                              </button>
                              <button type="button" className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => handleRemoveFile(doc.id)}>
                                <Icon name="trash" size={14} /> Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="pm-doc-upload-btn" onClick={() => fileInputRefs.current[doc.id]?.click()}>
                            <Icon name="upload" size={16} /> Choose file (PDF, JPG, PNG - max 5MB)
                          </button>
                        )}

                        {showError && <span className="pm-error-text">{showError}</span>}

                        <input
                          ref={(el) => {
                            fileInputRefs.current[doc.id] = el;
                          }}
                          type="file"
                          accept={ACCEPT_ATTR}
                          style={{ display: "none" }}
                          onChange={(e) => handleFileSelected(doc, e.target.files?.[0])}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </DrawerSection>
          )}

          {step === 3 && (
            <>
              <DrawerSection title="Personal Information" icon="user">
                <div className="pm-review-grid">
                  <div><span>Name</span><strong>{personal.name}</strong></div>
                  <div><span>Email</span><strong>{personal.email}</strong></div>
                  <div><span>Phone</span><strong>+{selectedCountry.dialCode} {phone.localNumber}</strong></div>
                  <div><span>Date of Birth</span><strong>{dob || "-"}</strong></div>
                </div>
              </DrawerSection>
              <DrawerSection title="Product Information" icon="grid">
                <div className="pm-review-grid">
                  <div><span>Employment Type</span><strong>{employmentType}</strong></div>
                  {applicationFields.map((f) => (
                    <div key={f.id}>
                      <span>{formatFieldLabel(f.label)}</span>
                      <strong>{formatFieldValue(f.dataType, dynamicValues[f.id] ?? "", f.unit ?? undefined) || "-"}</strong>
                    </div>
                  ))}
                </div>
              </DrawerSection>
              <DrawerSection title="Documents" icon="file">
                {requiredDocs.length === 0 ? (
                  <p className="pm-hint">No documents required.</p>
                ) : (
                  <ul className="pm-doc-list">
                    {requiredDocs.map((doc) => {
                      const state = docState[doc.id];
                      return (
                        <li key={doc.id}>
                          <span className="pm-doc-list-name">
                            <Icon name="file" size={16} />
                            {doc.name}
                          </span>
                          <span className="pm-row-actions">
                            {state?.file ? (
                              <>
                                <span className={`pm-badge ${state.error ? "pm-badge-danger" : "pm-badge-success"}`}>{state.error ? "Invalid" : "Ready"}</span>
                                {!state.error && (
                                  <button type="button" className="pm-icon-btn" onClick={() => handlePreviewFile(doc.id, doc.name)}>
                                    <Icon name="eye" size={14} />
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="pm-badge pm-badge-neutral">{doc.required ? "Missing" : "Not provided"}</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DrawerSection>
              {(hasPersonalErrors || hasProductErrors || hasDocumentErrors) && (
                <div className="pm-field-error-banner">Some information is missing or invalid. Please go back and fix the highlighted fields before submitting.</div>
              )}
            </>
          )}
        </>
      )}
      <DocumentPreviewModal
        isOpen={!!previewModal}
        fileUrl={previewModal?.url ?? null}
        title={previewModal?.title ?? ""}
        fileName={previewModal?.fileName}
        onClose={() => setPreviewModal(null)}
      />
    </Drawer>
  );
}
