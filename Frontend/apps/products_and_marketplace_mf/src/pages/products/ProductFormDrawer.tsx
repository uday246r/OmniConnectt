import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Drawer, EmptyState, Icon, Input, Select, SkeletonBlock } from '@omniconnect/ui';
import { CatalogIcon } from '../../components/CatalogIcon';
import { IconPicker } from '../../components/IconPicker';
import { Field } from '../../components/form/Field';
import { TextArea } from '../../components/form/TextArea';
import { useSaveAction } from '../../hooks/useSaveAction';
import { productApi } from '../../services/productApi';
import { subCategoryApi } from '../../services/subCategoryApi';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
import { useStatusOptions } from '../../stores/useStatusConfigStore';
import { useToastStore } from '../../stores/useToastStore';
import { CODE_HINT, hasErrors, validateCode, validateDescription, validateName } from '../../utils/catalogForm';
import { buildFieldValues, initialFieldValues, placeServerErrors, validateProductFields } from '../../utils/productForm';
import type { FieldDefinition, ProductDetail, ProductListItem } from '../../types/domain';
import { ProductFieldInput } from './ProductFieldInput';
import page from '../page.module.css';
import styles from './products.module.css';

export interface ProductFormDrawerProps {
  open: boolean;
  /** The product being edited, or null to add one. */
  product: ProductListItem | null;
  /** Pre-selects where a new product goes, when adding from a filtered view. */
  defaultCategoryId?: string;
  defaultSubCategoryId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface Basics {
  categoryId: string;
  subCategoryId: string;
  name: string;
  code: string;
  shortDescription: string;
  description: string;
  iconKey: string;
  status: string;
}

interface ListItem { title: string; description: string }
interface Criterion { criteria: string; description: string }

const FORM_ID = 'product-form';
const BLANK: Basics = { categoryId: '', subCategoryId: '', name: '', code: '', shortDescription: '', description: '', iconKey: '', status: '' };

/**
 * Add a product, or edit one.
 *
 * The form is built from the catalogue: choosing a category and then a sub-category decides which
 * attributes appear, because the sub-category defines them. A home loan asks for a rate and a tenure, a
 * card for its fees; adding a new attribute in Setup adds it here with no change to this file. Failures
 * come back per field from the server and are placed on the fields they name.
 */
export function ProductFormDrawer({ open, product, defaultCategoryId, defaultSubCategoryId, onClose, onSaved }: ProductFormDrawerProps) {
  const isEdit = product !== null;
  const statusOptions = useStatusOptions('Product');
  const categories = useCatalogOptionsStore((s) => s.categories);
  const subCategoriesByCategory = useCatalogOptionsStore((s) => s.subCategoriesByCategory);
  const loadCategories = useCatalogOptionsStore((s) => s.loadCategories);
  const loadSubCategories = useCatalogOptionsStore((s) => s.loadSubCategories);
  const save = useSaveAction();

  const [basics, setBasics] = useState<Basics>(BLANK);
  const [values, setValues] = useState<Record<string, string>>({});
  const [benefits, setBenefits] = useState<ListItem[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [definitions, setDefinitions] = useState<FieldDefinition[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});

  // Which sub-category the values currently belong to, so a change of sub-category clears them and a
  // definitions load that arrives late for a previous choice is ignored.
  const [valuesFor, setValuesFor] = useState('');

  useEffect(() => {
    if (open) void loadCategories();
  }, [open, loadCategories]);

  useEffect(() => {
    if (open && basics.categoryId) void loadSubCategories(basics.categoryId);
  }, [open, basics.categoryId, loadSubCategories]);

  // Opening: start blank, or from the product — whose details (description, benefits, values) need one more read.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSubmitted(false);
    setServerFieldErrors({});
    setLoadError(null);
    save.reset();

    if (!product) {
      setBasics({ ...BLANK, categoryId: defaultCategoryId ?? '', subCategoryId: defaultSubCategoryId ?? '', status: statusOptions[0]?.value ?? '' });
      setValues({});
      setBenefits([]);
      setCriteria([]);
      setValuesFor(defaultSubCategoryId ?? '');
      return;
    }

    setDetailLoading(true);
    productApi
      .get(product.id)
      .then((detail: ProductDetail) => {
        if (cancelled) return;
        setBasics({
          categoryId: detail.categoryId, subCategoryId: detail.subCategoryId, name: detail.name, code: detail.code,
          shortDescription: detail.shortDescription, description: detail.description, iconKey: detail.iconKey, status: detail.status,
        });
        setValues(initialFieldValues(detail));
        setBenefits(detail.benefits.map((b) => ({ title: b.title, description: b.description })));
        setCriteria(detail.eligibilityCriteria.map((e) => ({ criteria: e.criteria, description: e.description })));
        setValuesFor(detail.subCategoryId);
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
    // Only when it opens or the record changes: a status list finishing loading must not wipe what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id, defaultCategoryId, defaultSubCategoryId]);

  // The attributes come from the chosen sub-category's definitions.
  useEffect(() => {
    if (!open || !basics.subCategoryId) {
      setDefinitions([]);
      return;
    }
    let cancelled = false;
    setDefinitionsLoading(true);
    subCategoryApi
      .get(basics.subCategoryId)
      .then((detail) => !cancelled && setDefinitions([...detail.fieldDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setDefinitionsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, basics.subCategoryId]);

  const setBasic = <K extends keyof Basics>(key: K, value: Basics[K]) => setBasics((current) => ({ ...current, [key]: value }));

  const chooseCategory = (categoryId: string) => setBasics((current) => ({ ...current, categoryId, subCategoryId: '' }));
  const chooseSubCategory = (subCategoryId: string) => {
    setBasics((current) => ({ ...current, subCategoryId }));
    if (subCategoryId !== valuesFor) {
      setValues({});
      setServerFieldErrors({});
      setValuesFor(subCategoryId);
    }
  };

  const basicErrors = {
    subCategoryId: basics.subCategoryId ? undefined : 'Choose the sub-category this product belongs to.',
    name: validateName(basics.name, 'Product', 200),
    code: validateCode(basics.code, 'Product', 50),
    shortDescription: basics.shortDescription.length > 500 ? 'Short description cannot exceed 500 characters.' : undefined,
    description: validateDescription(basics.description, 4000),
  };
  const fieldErrors = useMemo(() => validateProductFields(definitions, values), [definitions, values]);
  const shownBasic = (key: keyof typeof basicErrors) => (submitted ? basicErrors[key] : undefined);
  const shownField = (id: string) => serverFieldErrors[id] ?? (submitted ? fieldErrors[id] : undefined);

  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: c.name })), [categories]);
  const subOptions = useMemo(() => (subCategoriesByCategory[basics.categoryId] ?? []).map((s) => ({ value: s.id, label: s.name })), [subCategoriesByCategory, basics.categoryId]);
  const options = statusOptions.map((s) => ({ value: s.value, label: s.label }));
  if (product && !options.some((o) => o.value === basics.status) && basics.status) options.push({ value: basics.status, label: basics.status });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerFieldErrors({});
    if (hasErrors(basicErrors) || hasErrors(fieldErrors)) return;

    const input = {
      subCategoryId: basics.subCategoryId,
      name: basics.name.trim(),
      code: basics.code.trim(),
      shortDescription: basics.shortDescription.trim(),
      description: basics.description.trim(),
      iconKey: basics.iconKey,
      status: basics.status,
      fieldValues: buildFieldValues(definitions, values),
      benefits: benefits.filter((b) => b.title.trim()).map((b) => ({ title: b.title.trim(), description: b.description.trim(), iconKey: '' })),
      eligibilityCriteria: criteria.filter((c) => c.criteria.trim()).map((c) => ({ criteria: c.criteria.trim(), description: c.description.trim() })),
    };

    const ok = await save.run(() => (product ? productApi.update(product.id, input) : productApi.create(input)), {
      onSaved: () => {
        useToastStore.getState().success(isEdit ? 'Product updated' : 'Product added', `"${input.name}" was saved.`);
        onSaved();
        onClose();
      },
      onPending: onClose,
    });
    void ok;
  };

  // The server names failing fields by key; put each message on its field.
  const placed = useMemo(() => placeServerErrors(definitions, save.fieldErrors), [definitions, save.fieldErrors]);
  useEffect(() => {
    setServerFieldErrors(placed.byField);
  }, [placed]);

  const loading = detailLoading;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="680px"
      title={isEdit ? 'Edit product' : 'Add product'}
      subtitle="A specific offering — Home Loan – Salaried — filed under a sub-category."
      icon={<CatalogIcon iconKey={basics.iconKey} size="sm" />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.saving}>Cancel</Button>
          <Button type="submit" form={FORM_ID} loading={save.saving} disabled={save.saving || loading} leadingIcon={<Icon.Check />}>
            {isEdit ? 'Save changes' : 'Add product'}
          </Button>
        </>
      }
    >
      {loadError ? (
        <EmptyState title="Could not load this product" description={loadError} />
      ) : loading ? (
        <SkeletonBlock width="100%" height={320} />
      ) : (
        <form id={FORM_ID} onSubmit={submit} noValidate className={styles.section}>
          {save.error && (
            <p role="alert" className={page.error}>
              {[save.error, ...placed.unplaced].filter((m, i, all) => all.indexOf(m) === i).join(' ')}
            </p>
          )}

          <h3 className={styles.sectionTitle}>Where it belongs</h3>
          <div className={page.formGrid}>
            <Field label="Category" required>
              <Select aria-label="Category" options={categoryOptions} value={basics.categoryId} placeholder="Choose a category" onChange={(e) => chooseCategory(e.target.value)} />
            </Field>
            <Field label="Sub-category" required error={shownBasic('subCategoryId')}>
              <Select
                aria-label="Sub-category"
                options={subOptions}
                value={basics.subCategoryId}
                placeholder={basics.categoryId ? 'Choose a sub-category' : 'Choose a category first'}
                disabled={!basics.categoryId}
                onChange={(e) => chooseSubCategory(e.target.value)}
              />
            </Field>
          </div>
          {isEdit && product && basics.subCategoryId !== product.subCategoryId && (
            <p className={styles.hint}>Moving this product to another sub-category clears its attribute values — that sub-category defines different ones.</p>
          )}

          <h3 className={styles.sectionTitle}>Basics</h3>
          <div className={page.formGrid}>
            <div className={page.wide}><Input label="Product name" value={basics.name} onChange={(e) => setBasic('name', e.target.value)} errorText={shownBasic('name')} helperText="The offering, e.g. Home Loan – Salaried." required /></div>
            <Input label="Product code" value={basics.code} onChange={(e) => setBasic('code', e.target.value)} errorText={shownBasic('code')} helperText={CODE_HINT} required />
            <Field label="Status" helper="Which statuses exist, and which make a product live, is set in Setup.">
              <Select aria-label="Status" options={options} value={basics.status} onChange={(e) => setBasic('status', e.target.value)} />
            </Field>
            <div className={page.wide}><TextArea label="Short description" value={basics.shortDescription} onChange={(e) => setBasic('shortDescription', e.target.value)} errorText={shownBasic('shortDescription')} rows={2} helperText="Shown on the product card." /></div>
            <div className={page.wide}><TextArea label="Description" value={basics.description} onChange={(e) => setBasic('description', e.target.value)} errorText={shownBasic('description')} rows={4} /></div>
            <div className={page.wide}>
              <Field label="Icon"><IconPicker label="Product icon" value={basics.iconKey} onChange={(key) => setBasic('iconKey', key)} /></Field>
            </div>
          </div>

          <h3 className={styles.sectionTitle}>Attributes</h3>
          {!basics.subCategoryId ? (
            <p className={styles.hint}>Choose a sub-category to see the attributes its products carry.</p>
          ) : definitionsLoading ? (
            <SkeletonBlock width="100%" height={120} />
          ) : definitions.length === 0 ? (
            <p className={styles.hint}>This sub-category has no attributes yet. Define them in Setup → Fields, and they will appear here.</p>
          ) : (
            <div className={page.formGrid}>
              {definitions.map((definition) => (
                <ProductFieldInput
                  key={definition.id}
                  field={definition}
                  value={values[definition.id] ?? ''}
                  error={shownField(definition.id)}
                  onChange={(value) => setValues((current) => ({ ...current, [definition.id]: value }))}
                />
              ))}
            </div>
          )}

          <h3 className={styles.sectionTitle}>Benefits</h3>
          {benefits.map((benefit, index) => (
            <div key={index} className={styles.listRow}>
              <Input label={index === 0 ? 'Benefit' : undefined} aria-label={`Benefit ${index + 1}`} value={benefit.title} placeholder="e.g. Low interest rate" onChange={(e) => setBenefits((list) => list.map((b, i) => (i === index ? { ...b, title: e.target.value } : b)))} />
              <Input label={index === 0 ? 'Details (optional)' : undefined} aria-label={`Benefit ${index + 1} details`} value={benefit.description} onChange={(e) => setBenefits((list) => list.map((b, i) => (i === index ? { ...b, description: e.target.value } : b)))} />
              <button type="button" className={styles.remove} aria-label={`Remove benefit ${index + 1}`} onClick={() => setBenefits((list) => list.filter((_, i) => i !== index))}><Icon.Trash /></button>
            </div>
          ))}
          <div><Button variant="secondary" size="sm" leadingIcon={<Icon.Plus />} onClick={() => setBenefits((list) => [...list, { title: '', description: '' }])}>Add benefit</Button></div>

          <h3 className={styles.sectionTitle}>Eligibility</h3>
          {criteria.map((item, index) => (
            <div key={index} className={styles.listRow}>
              <Input label={index === 0 ? 'Criterion' : undefined} aria-label={`Criterion ${index + 1}`} value={item.criteria} placeholder="e.g. Age 21–60" onChange={(e) => setCriteria((list) => list.map((c, i) => (i === index ? { ...c, criteria: e.target.value } : c)))} />
              <Input label={index === 0 ? 'Details (optional)' : undefined} aria-label={`Criterion ${index + 1} details`} value={item.description} onChange={(e) => setCriteria((list) => list.map((c, i) => (i === index ? { ...c, description: e.target.value } : c)))} />
              <button type="button" className={styles.remove} aria-label={`Remove criterion ${index + 1}`} onClick={() => setCriteria((list) => list.filter((_, i) => i !== index))}><Icon.Trash /></button>
            </div>
          ))}
          <div><Button variant="secondary" size="sm" leadingIcon={<Icon.Plus />} onClick={() => setCriteria((list) => [...list, { criteria: '', description: '' }])}>Add criterion</Button></div>
        </form>
      )}
    </Drawer>
  );
}
