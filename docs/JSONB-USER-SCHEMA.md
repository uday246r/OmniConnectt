# The JSONB Admin-Configurable User Schema — Full Build Guide

> **What this document is:** a complete, in-depth walkthrough of the JSONB-backed "admin can change
> what the Create/Edit User form asks for" system — every file, why it exists, what's in it, and the
> order you'd build it in if you had to do the whole thing yourself from scratch.

---

## 1. The problem this solves

Before this system, "which questions do we ask when creating a user" was **hardcoded in two places**:

- `Backend/AuthService/Domain/Entities/User.cs` — fixed columns (`Name`, `Email`, `PhoneNumber`, …)
- `Frontend/apps/host/src/layout/SettingsDrawer/UserFormLayer.tsx` — a fixed "Personal Information"
  card, with validation hand-duplicated in `shared/validation/rules.ts`

So if a company said *"we also need to capture Aadhar Number"*, that meant: a migration, a new column,
a new form field, new validation on both sides, a code review, and a deploy. For a **data-entry
change**. And because the rules lived in two files, they drifted.

**The goal:** let a non-technical admin add "Aadhar Number", make "Mobile Number" stricter, or invent
a company-specific format — through a UI, with no deploy — while the server still refuses anything
invalid, because the browser can always be bypassed.

---

## 2. The core design decision: two tiers, not one

The tempting design is "put *everything* in JSONB." That's wrong here, and understanding why is the
key to the whole system.

| Tier | Fields | Storage | Who controls existence | Who controls validation |
|---|---|---|---|---|
| **Core** | `name`, `email`, `phoneNumber` | Real `User` **columns** | Locked — code only | **Admin-editable** |
| **Custom** | Anything admin adds (Aadhar, Employee Code…) | `User.ExtraAttributes` **jsonb** | Admin | Admin |
| **Excluded** | `Role`, `Status` | Real columns | Code only | **Not in this system at all** |

**Why core fields stay real columns:** `email` backs login and has a unique index. `name` is
sorted/searched in the Users list. If those moved into JSONB, a bad schema edit could break sign-in or
the user list. So the admin can change *how `email` is validated*, never *whether `email` exists*.

**Why Role and Status are excluded entirely:** they're access control, not data shape. There is
nothing to "validate" about a dropdown, and letting a non-technical admin attach rules to a
permission-relevant field is a security risk for zero benefit. They keep their existing, reviewed code
path, untouched.

**Why JSONB and not an EAV table:** the schema is read on *every* form render and written rarely. One
row, one round-trip, no joins. Postgres `jsonb` also gives real indexing/querying later if needed,
unlike a `text` column.

---

## 3. The three catalogs

There isn't one JSONB blob — there are **three independent ones**, each the same shape (one row, one
JSON column, a `Version` counter):

| Entity | Column | Admin screen | What it holds |
|---|---|---|---|
| `UserFieldSchema` | `SchemaJson` | Manage Fields | Which fields the form collects + their rules |
| `ValidationPresetCatalog` | `PresetsJson` | Manage Formats | Reusable named formats a field can reference |
| `SalutationCatalog` | `SalutationsJson` | Manage Fields (top card) | The Mr./Ms./Dr. dropdown list |

Plus a fourth JSONB column that holds the **values**, not the config:

| Entity | Column | What it holds |
|---|---|---|
| `User` | `ExtraAttributes` | `{ "aadharNumber": "1234 5678 9012" }` — this user's custom field values |

### How they reference each other

```
UserFieldSchema.SchemaJson
  └── fields[]
        └── validations[]
              └── type: "aadharFormat"      ──► fixed catalog   (FieldPresets.cs / fieldPresets.ts)
              └── type: "employeeIdRange"   ──► ValidationPresetCatalog.PresetsJson  (admin-defined)
              └── type: "custom" + pattern  ──► inline one-off regex, no catalog lookup
```

A rule's `type` is looked up **in that order**: built-in special cases → admin catalog → fixed
catalog → *give up and pass*. That last step is the **fail-open rule** (see §9).

---

## 4. Data flow at a glance

```
ADMIN CONFIGURES                          USER IS CREATED
─────────────────                         ───────────────
ManageFieldsPage                          UserFormLayer (Create User)
   │ PUT /api/user-schema                    │ GET /api/user-schema  ─┐
   ▼                                         │ GET /api/salutations   ├─ 3 parallel loads
UserSchemaController                         │ GET /api/validation-presets
   │ [RequirePermission(users, Edit)]        ▼
   ▼                                      renders one input per field, in `order`
UserFieldSchemaAppService.UpdateAsync         │ types → validateFields() (AJV, instant)
   │ ValidateShape()  ← guards               ▼
   │ JsonSerializer.Serialize                POST /api/users { name, email, customFields: {...} }
   ▼                                         │
UserFieldSchemas.SchemaJson (jsonb)          ▼
   Version += 1                           UserAppService.CreateAsync
                                             │ ValidateAndBuildExtraAttributesAsync()
                                             │   → UserSchemaValidator.Validate()  ← SERVER RE-CHECK
                                             │   → drops keys not in schema
                                             ▼
                                          User.ExtraAttributes (jsonb) + real columns
```

**The single most important thing in that diagram:** validation runs **twice**, in two independent
implementations. The browser one is for UX (instant feedback). The server one is the actual authority.

---

## 5. Build order — how you'd do this yourself

Build strictly bottom-up. Each step compiles and is testable before the next.

### Step 1 — Database layer

**1a. `Backend/AuthService/Domain/Entities/UserFieldSchema.cs`** *(new)*

Deliberately dumb: the JSON is a `string` here. Parsing is the service's job, so the entity has no
opinion about the shape and EF never tries to map nested objects.

```csharp
public class UserFieldSchema
{
    public Guid Id { get; set; }
    public required string SchemaJson { get; set; }
    public int Version { get; set; }          // bumped on every save — optimistic-concurrency ready
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
```

`ValidationPresetCatalog.cs` and `SalutationCatalog.cs` are the *same shape* with `PresetsJson` /
`SalutationsJson`. Copy-paste is correct here — they're independent lifecycles that happen to look
alike, not a shared abstraction.

**1b. `Backend/AuthService/Domain/Entities/User.cs`** *(modified — 2 additions)*

```csharp
/// <summary>Title/salutation (Mr., Ms., Dr., ...) — optional, drawn from SalutationCatalog.</summary>
public string? Salutation { get; set; }

/// <summary>Values for admin-defined custom fields. jsonb object of fieldKey -> string value.
/// Null for a user with no custom field values set.</summary>
public string? ExtraAttributes { get; set; }
```

**1c. `Backend/AuthService/Infrastructure/AuthDbContext.cs`** *(modified)*

Register the DbSets, then — **this is the line that actually makes it JSONB**:

```csharp
public DbSet<UserFieldSchema> UserFieldSchemas => Set<UserFieldSchema>();
public DbSet<ValidationPresetCatalog> ValidationPresetCatalogs => Set<ValidationPresetCatalog>();
public DbSet<SalutationCatalog> SalutationCatalogs => Set<SalutationCatalog>();

// inside OnModelCreating:
entity.Property(u => u.Salutation).HasMaxLength(20);
entity.Property(u => u.ExtraAttributes).HasColumnType("jsonb");   // ← User

modelBuilder.Entity<UserFieldSchema>(e => e.Property(s => s.SchemaJson).HasColumnType("jsonb"));
modelBuilder.Entity<ValidationPresetCatalog>(e => e.Property(c => c.PresetsJson).HasColumnType("jsonb"));
modelBuilder.Entity<SalutationCatalog>(e => e.Property(c => c.SalutationsJson).HasColumnType("jsonb"));
```

> Without `.HasColumnType("jsonb")` you get a `text` column. It still *works*, but you lose Postgres
> JSON operators/indexing and the DB can't reject malformed JSON. This one line is the whole "JSONB"
> part.

**1d. Migrations** — three of them, generated with `dotnet ef migrations add <Name>`:

- `20260910051640_AddUserFieldSchemaAndExtraAttributes`
- `20260910061633_AddValidationPresetCatalog`
- `20260910063608_AddSalutationCatalogAndUserSalutation`

The first one, in full — note `type: "jsonb"` carried through from the model config:

```csharp
migrationBuilder.AddColumn<string>(
    name: "ExtraAttributes", table: "Users", type: "jsonb", nullable: true);

migrationBuilder.CreateTable(
    name: "UserFieldSchemas",
    columns: table => new
    {
        Id = table.Column<Guid>(type: "uuid", nullable: false),
        SchemaJson = table.Column<string>(type: "jsonb", nullable: false),
        Version = table.Column<int>(type: "integer", nullable: false),
        UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
        UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true)
    },
    constraints: table => table.PrimaryKey("PK_UserFieldSchemas", x => x.Id));
```

---

### Step 2 — The contract (DTOs)

**`Backend/AuthService/Application/DTOs/UserFieldSchemaDtos.cs`** *(new)*

These records **are** the JSON shape stored in the column. Serialize a `List<FieldDefinitionDto>` and
that's `SchemaJson`. Same records serve the API. One shape, three uses (storage, wire, validation).

```csharp
public record ValidationRuleDto(string Type, string? Pattern, int? Value, string Message);

public record FieldDefinitionDto(
    string Key, string Label, bool Core, string DataType,
    bool Required, int Order, IReadOnlyList<ValidationRuleDto> Validations);

public record UserFieldSchemaDto(IReadOnlyList<FieldDefinitionDto> Fields, int Version, DateTimeOffset UpdatedAt);
public record UpdateUserFieldSchemaRequest(IReadOnlyList<FieldDefinitionDto> Fields);
public record FieldValidationErrorDto(string FieldKey, string Message);
```

Field meanings:
- `Key` — the internal id (`aadharNumber`). Auto-derived from the label in the UI; the admin never types it.
- `Core` — is this one of the three real columns? Locked set, enforced server-side.
- `Order` — display order; the frontend sorts by it.
- `Validations` — the rule list. `Type` is a catalog key; `Pattern` only for `"custom"`; `Value` only
  for length presets.

**What the stored JSON actually looks like:**

```json
[
  { "key": "name",  "label": "Full Name", "core": true, "dataType": "text", "required": true, "order": 1,
    "validations": [] },
  { "key": "email", "label": "Email Address", "core": true, "dataType": "email", "required": true, "order": 2,
    "validations": [ { "type": "emailSmart", "pattern": null, "value": null, "message": "Enter a valid email address." } ] },
  { "key": "aadharNumber", "label": "Aadhar Number", "core": false, "dataType": "text", "required": false, "order": 4,
    "validations": [ { "type": "aadharFormat", "pattern": null, "value": null, "message": "Enter a valid 12-digit Aadhar number." } ] }
]
```

> **camelCase matters.** Serialization uses `JsonSerializerDefaults.Web`, so C# `Key` → JSON `key`.
> The TypeScript interfaces must match *that*, not the C# casing.

---

### Step 3 — Backend validation engine

**3a. `Backend/AuthService/Infrastructure/Validation/FieldPresets.cs`** *(new)* — the fixed catalog.
Just constants + a regex lookup table. Data, not code paths, so adding "PAN format" later is one
dictionary entry:

```csharp
public const string LettersOnly = "lettersOnly";
public const string AadharFormat = "aadharFormat";
public const string EmailSmart = "emailSmart";
public const string Custom = "custom";
// ... plus the four admin-preset kinds:
public const string CustomPresetKindRegex = "regex";
public const string CustomPresetKindLengthRange = "lengthRange";
public const string CustomPresetKindNumericRange = "numericRange";
public const string CustomPresetKindTextPattern = "textPattern";

public static bool TryGetRegex(string presetId, out Regex regex) => RegexPresets.TryGetValue(presetId, out regex!);
```

**3b. `EmailSmartValidator.cs`** *(new)* — email checking including near-miss domain detection
(`gmial.com`). Kept as real C# rather than regex because it's a judgement call, not a pattern.

**3c. `UserSchemaValidator.cs`** *(new)* — **the server-side authority.** Given the schema + the
submitted values, return a list of `(fieldKey, message)`:

```csharp
public IReadOnlyList<FieldValidationErrorDto> Validate(
    IEnumerable<FieldDefinitionDto> fields, IReadOnlyDictionary<string, string?> values,
    IReadOnlyList<CustomPresetDto>? customPresets = null)
{
    var errors = new List<FieldValidationErrorDto>();
    var presetsByKey = (customPresets ?? []).ToDictionary(p => p.Key);

    foreach (var field in fields)
    {
        values.TryGetValue(field.Key, out var raw);
        var value = raw?.Trim();

        // Core required-ness is already enforced by DTO data annotations and never weakened here.
        if (!field.Core && field.Required && string.IsNullOrEmpty(value))
        {
            errors.Add(new FieldValidationErrorDto(field.Key, $"{field.Label} is required."));
            continue;
        }

        if (string.IsNullOrEmpty(value)) continue;   // optional + empty → nothing to check

        foreach (var rule in field.Validations)
        {
            var message = EvaluateRule(rule, value, presetsByKey);
            if (message is not null)
            {
                errors.Add(new FieldValidationErrorDto(field.Key, message));
                break;   // one problem per field — matches the frontend
            }
        }
    }
    return errors;
}
```

The dispatch order in `EvaluateRule` is the resolution chain from §3:

```csharp
switch (rule.Type)
{
    case FieldPresets.EmailSmart:  return EmailSmartValidator.IsValid(value) ? null : rule.Message;
    case FieldPresets.MobileIN:    return FieldPresets.MobileInDefaultShape.IsMatch(value) ? null : rule.Message;
    case FieldPresets.MinLength:   return value.Length >= (rule.Value ?? 0) ? null : rule.Message;
    case FieldPresets.Custom:      return IsCustomPatternMatch(rule.Pattern, value) ? null : rule.Message;
    default:
        if (customPresets.TryGetValue(rule.Type, out var preset))       // admin catalog
            return EvaluateCustomPreset(preset, value) ? null : rule.Message;
        return FieldPresets.TryGetRegex(rule.Type, out var regex)       // fixed catalog
            ? (regex.IsMatch(value) ? null : rule.Message)
            : null;                                                     // ← unknown id: FAIL OPEN
}
```

Note the regex timeout — an admin-authored pattern is untrusted input and can be catastrophic:

```csharp
return Regex.IsMatch(value, pattern, RegexOptions.None, TimeSpan.FromMilliseconds(200));
// catch ArgumentException or RegexMatchTimeoutException → return true (fail open)
```

---

### Step 4 — App services (the JSON boundary)

**`Backend/AuthService/Application/Services/UserFieldSchemaAppService.cs`** *(new)* — this is the
*only* place that serializes/deserializes the schema. Everything above it works with typed DTOs.

```csharp
private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

public static readonly IReadOnlyDictionary<string, string> ReservedCoreKeys = new Dictionary<string, string>
{
    ["name"] = "text", ["email"] = "email", ["phoneNumber"] = "text",
};

public async Task<UserFieldSchemaDto> GetAsync(CancellationToken ct = default)
{
    var row = await db.UserFieldSchemas.AsNoTracking()
        .OrderByDescending(s => s.UpdatedAt).FirstOrDefaultAsync(ct);

    if (row is null)
        return new UserFieldSchemaDto(DefaultFields(), 0, DateTimeOffset.UtcNow);   // never 500

    var fields = JsonSerializer.Deserialize<List<FieldDefinitionDto>>(row.SchemaJson, JsonOptions) ?? [];
    return new UserFieldSchemaDto(fields, row.Version, row.UpdatedAt);
}
```

`UpdateAsync` is a **full-list replace** (not a patch) + `Version += 1`:

```csharp
ValidateShape(request.Fields);
var schemaJson = JsonSerializer.Serialize(request.Fields, JsonOptions);
if (row is null) { /* insert with Version = 1 */ } else { row.SchemaJson = schemaJson; row.Version += 1; }
```

**`ValidateShape` is the guard rail** — everything a non-technical admin could break:

| Guard | Why |
|---|---|
| At least one field | An empty form is never valid |
| No duplicate keys (case-insensitive) | Two fields writing the same JSON key |
| Non-core field can't claim a reserved key | Would shadow a real column |
| `Core: true` only on the three reserved keys | Schema can't invent a "core" field with no column |
| `custom` rule must have a **compilable** regex | Caught at save, not at every future form render |
| All three core keys must be present | The form must always collect name/email/phone |

```csharp
if (field.Core && !isReservedKey)
    throw new ValidationAppException($"'{field.Key}' cannot be marked as a core field.");
if (!field.Core && isReservedKey)
    throw new ValidationAppException($"'{field.Key}' is a reserved core field name.");

if (rule.Type == FieldPresets.Custom)
{
    if (string.IsNullOrWhiteSpace(rule.Pattern)) throw new ValidationAppException(...);
    try { _ = new Regex(rule.Pattern); }
    catch (ArgumentException) { throw new ValidationAppException($"...invalid custom pattern: {rule.Pattern}"); }
}
```

---

### Step 5 — Controllers + DI

**`Controllers/UserSchemaController.cs`** *(new)* — note it deliberately **reuses the Users
permission** rather than seeding its own:

```csharp
[ApiController, Route("api/user-schema"), Authorize]
public class UserSchemaController(UserFieldSchemaAppService schema) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsUsers;

    [HttpGet]  [RequirePermission(Feature, "View")]
    public async Task<ActionResult<UserFieldSchemaDto>> Get(CancellationToken ct) => Ok(await schema.GetAsync(ct));

    [HttpPut]  [RequirePermission(Feature, "Edit")]
    public async Task<ActionResult<UserFieldSchemaDto>> Update(
        [FromBody] UpdateUserFieldSchemaRequest request, CancellationToken ct)
        => Ok(await schema.UpdateAsync(request, CurrentUserId(), ct));
}
```

> **Design call:** managing the fields on the user form *is* part of the Users capability. A separate
> permission would mean a new catalog entry, new role-editor rows, and a new thing to forget to grant.

`ValidationPresetsController` (`/api/validation-presets`) and `SalutationsController`
(`/api/salutations`) follow the identical pattern.

**`Program.cs`** *(modified)* — four registrations:

```csharp
builder.Services.AddScoped<UserFieldSchemaAppService>();
builder.Services.AddScoped<ValidationPresetAppService>();
builder.Services.AddScoped<SalutationAppService>();
builder.Services.AddScoped<AuthService.Infrastructure.Validation.UserSchemaValidator>();
```

---

### Step 6 — Wire into user creation (where values get written)

**`Application/Services/UserAppService.cs`** *(modified)* — the consumer. One private method does the
validate-and-filter, called by both create and update:

```csharp
private async Task<string?> ValidateAndBuildExtraAttributesAsync(
    string name, string email, string? phoneNumber,
    IReadOnlyDictionary<string, string>? customFields, CancellationToken ct)
{
    var fields = await fieldSchema.GetFieldsAsync(ct);
    var customPresets = await validationPresets.GetPresetsAsync(ct);

    var values = new Dictionary<string, string?>
    { ["name"] = name, ["email"] = email, ["phoneNumber"] = phoneNumber };

    var allowedCustomKeys = fields.Where(f => !f.Core).Select(f => f.Key).ToHashSet();
    var extraAttributes = new Dictionary<string, string>();

    if (customFields is not null)
        foreach (var (key, value) in customFields)
        {
            if (!allowedCustomKeys.Contains(key)) continue;   // ← silently DROP unknown keys
            values[key] = value;
            if (!string.IsNullOrWhiteSpace(value)) extraAttributes[key] = value.Trim();
        }

    var errors = schemaValidator.Validate(fields, values, customPresets);
    if (errors.Count > 0) throw new FieldValidationException(errors);

    return extraAttributes.Count > 0 ? JsonSerializer.Serialize(extraAttributes) : null;
}
```

Three subtle behaviours worth internalising:

1. **Unknown keys are dropped, not rejected.** If an admin deletes "Aadhar Number" from the schema, a
   stale browser tab still posting `aadharNumber` won't resurrect it — and won't error either.
2. **Blank values aren't stored.** `ExtraAttributes` is `null` rather than `{}` when nothing is set.
3. **Core fields go through the same validator** as custom ones, so an admin-added rule on `email`
   is enforced server-side too — layered *on top of* the DTO's fixed annotations, never replacing them.

**The `null` vs `{}` distinction in `UpdateAsync`** — this was a real bug, worth calling out:

```csharp
// null means "this submission never touched custom fields" (ProfilePage self-edit has no custom-field
// UI) → keep existing. An explicit dictionary — even {} — is a full replacement set.
var customFieldsForValidation = request.CustomFields ?? DeserializeExtraAttributes(user.ExtraAttributes);
```

Treating `null` as "wipe everything" silently erased a user's Aadhar Number the first time they edited
their own name from the Profile page.

---

### Step 7 — Error surfacing

**`Application/Exceptions/AppExceptions.cs`** *(modified)*

```csharp
public class FieldValidationException(IReadOnlyList<FieldValidationErrorDto> errors)
    : Exception("One or more fields failed validation.")
{
    public IReadOnlyList<FieldValidationErrorDto> Errors { get; } = errors;
}
```

**`Infrastructure/AppExceptionFilter.cs`** *(modified)* — maps it to 400 and, crucially, attaches the
per-field detail so the UI can put each message on the right input:

```csharp
FieldValidationException ex => (StatusCodes.Status400BadRequest, ex.Message),
...
if (context.Exception is FieldValidationException fieldValidation)
    problem.Extensions["fieldErrors"] = fieldValidation.Errors;
```

---

### Step 8 — Frontend shared engine (`@omniremit/ui`)

Lives in `packages/ui` so the host **and** every remote micro-frontend judge a value identically.

**`packages/ui/package.json`** *(modified)*

```json
"exports": { ".": "./src/index.ts", "./validation": "./src/validation/index.ts", ... },
"dependencies": { "ajv": "^8.17.1", "ajv-formats": "^3.0.1", "lucide-react": "^1.31.0" }
```

**`src/validation/fieldPresets.ts`** *(new)* — the frontend twin of `FieldPresets.cs`. Each entry
carries a label, group, default message, an example pair, and either a JSON-Schema fragment
(`kind: 'jsonSchema'`) or a marker to delegate to existing code (`kind: 'builtin'`).

**`src/validation/schemaValidation.ts`** *(new)* — the AJV engine. TypeScript interfaces mirror the C#
DTOs exactly (camelCase):

```ts
export interface ValidationRule { type: string; pattern?: string | null; value?: number | null; message: string }
export interface FieldDefinition {
  key: string; label: string; core: boolean; dataType: string
  required: boolean; order: number; validations: ValidationRule[]
}
```

AJV is created **once** and compiled validators are **cached per preset** — not recompiled per
keystroke:

```ts
const ajv = new Ajv({ allErrors: false, strict: false })
addFormats(ajv)
const compiledPresetCache = new Map<string, ReturnType<typeof ajv.compile>>()

function compilePresetSchema(presetId: string) {
  const preset = findPreset(presetId)
  if (!preset || preset.kind !== 'jsonSchema') return undefined
  const cached = compiledPresetCache.get(presetId)
  if (cached) return cached
  const compiled = ajv.compile({ type: 'string', ...preset.schema })
  compiledPresetCache.set(presetId, compiled)
  return compiled
}
```

`evaluateRule` mirrors the C# `EvaluateRule` switch **case for case** — including fail-open:

```ts
default: {
  const custom = customPresets.find((p) => p.key === rule.type)
  if (custom) return evaluateCustomPreset(custom, value) ? undefined : rule.message
  const validator = compilePresetSchema(rule.type)
  if (!validator) return undefined      // unknown/stale preset id — fail open, see backend counterpart
  return validator(value) ? undefined : rule.message
}
```

Exported surface (`validateFields` is what the form calls; `testRule`/`testCustomPreset` power the
builder's live tester):

```ts
export { evaluateRule, validateFieldValue, validateFields, testRule, testCustomPreset } from './schemaValidation'
```

---

### Step 9 — Frontend API clients

`features/settings-user-fields/api/` — three thin typed fetch wrappers:

| File | Endpoint |
|---|---|
| `userSchemaApi.ts` | `GET`/`PUT /api/user-schema` |
| `customPresetsApi.ts` | `GET`/`PUT /api/validation-presets` |
| `salutationsApi.ts` | `GET`/`PUT /api/salutations` |

---

### Step 10 — Admin UI

| File | Role |
|---|---|
| `pages/ManageFieldsPage.tsx` | Field list, reorder, Add Field, Save Changes + the Salutations card |
| `pages/ManageFormatsPage.tsx` | The reusable-format catalog |
| `components/FieldEditorModal.tsx` | Add/Edit one field — label → auto-derived key, required toggle, stacked rules, **live tester** |
| `components/FormatEditorModal.tsx` | Add/Edit one reusable format (4 kinds) |
| `components/SalutationsCard.tsx` | Chip add/remove list |

The design principle throughout: **the admin never sees the word "regex" unless they ask for it.**
They pick "Aadhar number" from a grouped dropdown, get a plain-English default message they can edit,
and type a sample value to watch it pass/fail live. `"custom"` is the escape hatch, deliberately last
in the list.

Nothing persists until the page's own **Save Changes** — the modals only mutate on-screen state.

---

### Step 11 — Consumer UI (the actual payoff)

**`layout/SettingsDrawer/UserFormLayer.tsx`** *(modified)* — the hardcoded Name/Email/Phone JSX is
replaced by a loop over the schema.

Load three things in parallel, sort by `order`:

```ts
const [fields, setFields] = useState<FieldDefinition[]>([])
const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
// ...
userSchemaApi.get(accessToken!), salutationsApi.get(accessToken!), ...
const sortedFields = [...schemaRes.fields].sort((a, b) => a.order - b.order)
```

Validate the whole form in one call:

```ts
const fieldErrors = validateFields(fields, fieldValues)
```

Render one input per field:

```tsx
{fields.map((field) => {
  // Only the three core fields have a fixed, recognisable icon; a custom field gets a neutral default.
  return <input value={fieldValues[field.key] ?? ''} ... />
})}
```

Split core vs custom on submit — core to real columns, the rest into one bag:

```ts
const customFields = Object.fromEntries(
  fields.filter((f) => !f.core).map((f) => [f.key, (fieldValues[f.key] ?? '').trim()]),
)
// → POST /api/users { name, email, phoneNumber, salutation, customFields }
```

**`features/settings-users/api/usersApi.ts`** *(modified)* — the request/response types gain:

```ts
customFields: Record<string, string> | null
salutation: string | null
```

Also updated to display custom values: `UserDetailPage.tsx` (a "Custom Fields" section),
`ProfilePage.tsx`, `Topbar.tsx` and `DashboardPage.tsx` (salutation in the greeting).

---

### Step 12 — Routes and navigation

**`App.tsx`** *(modified)* — lazy pages, feature keys reusing Users, and routes:

```tsx
const ManageFieldsPage = lazy(() => import('./features/settings-user-fields/pages/ManageFieldsPage')...)
const FEATURE_KEYS = { ...,
  fields: 'host.settings.users',    // reuses Users — see UserSchemaController
  formats: 'host.settings.users',
}
<Route path="fields" element={<RequireCapability featureKey={FEATURE_KEYS.fields}><ManageFieldsPage /></RequireCapability>} />
```

**`Infrastructure/Seed/AuthDbSeeder.cs`** *(modified)* — two sidebar rows. `RequiredFeatureKey` points
at Users, consistent with the controllers:

```csharp
new HostNavItem { Key = "host.settings.fields",  Label = "Manage Fields",  IconKey = "FileText",
                  RoutePath = "/settings/fields",  SectionKey = "system", SortOrder = 50,
                  RequiredFeatureKey = HostFeatureKeys.SettingsUsers, RequiredCapability = "View" },
new HostNavItem { Key = "host.settings.formats", Label = "Manage Formats", IconKey = "Key",
                  RoutePath = "/settings/formats", SectionKey = "system", SortOrder = 60,
                  RequiredFeatureKey = HostFeatureKeys.SettingsUsers, RequiredCapability = "View" },
```

> ⚠️ **Nav seeding is insert-only.** It only adds rows whose `Key` is missing; it never updates or
> removes. So changing a `SortOrder`/`Label` in code does **not** affect a database that was already
> seeded — only fresh ones. Existing rows need a data fix.

---

### Step 13 — Tests

| File | Covers |
|---|---|
| `AuthService.Tests/UserSchemaValidatorTests.cs` | Rule dispatch, fail-open, required-ness |
| `AuthService.Tests/UserFieldSchemaAppServiceTests.cs` | Every `ValidateShape` guard |
| `AuthService.Tests/ValidationPresetAppServiceTests.cs` | Preset CRUD + version bump |
| `AuthService.Tests/SalutationAppServiceTests.cs` | Salutation catalog |
| `AuthService.Tests/FieldPresetsTests.cs` | Catalog integrity (no dup ids) |
| `AuthService.Tests/EmailSmartValidatorTests.cs` | Near-miss domains |
| `packages/ui/src/validation/schemaValidation.test.ts` | AJV engine, must agree with backend |
| `packages/ui/src/validation/fieldPresets.test.ts` | No duplicate ids, every preset has label + message |
| `apps/host/.../FieldEditorModal.test.tsx` | Key derivation, rule stacking, invalid regex refused |
| `apps/host/.../FormatEditorModal.test.tsx` | All four kinds, bounds validation |
| `apps/host/.../SalutationsCard.test.tsx` | Add/remove/dirty-state/duplicates |

---

## 6. Runtime flow: admin adds "Aadhar Number"

1. Manage Fields → **Add Field** → types label `Aadhar Number` → key auto-derives to `aadharNumber`
2. Picks rule **"Aadhar number"** → message pre-fills → types `1234 5678 9012` in the tester → ✅
3. **Save Field** → modal closes, list updates *in memory only*
4. **Save Changes** → `PUT /api/user-schema` with the whole field list
5. `[RequirePermission("host.settings.users", "Edit")]` → `ValidateShape` → serialize → `SchemaJson`,
   `Version += 1`

## 7. Runtime flow: someone creates a user

1. Create User → 3 parallel GETs (schema, salutations, presets)
2. Form renders 4 inputs sorted by `order`; Aadhar appears automatically
3. Typing runs `validateFields()` → AJV → instant inline errors
4. Submit → `POST /api/users` with `customFields: { aadharNumber: "..." }`
5. **Server re-validates** via `ValidateAndBuildExtraAttributesAsync` → drops unknown keys → on failure
   throws `FieldValidationException` → 400 + `fieldErrors[]`
6. On success: `name`/`email`/`phoneNumber` → real columns; `{"aadharNumber":"..."}` → `ExtraAttributes` jsonb

---

## 8. If it's Maker-Checker gated

`UserSnapshotDto` carries `CustomFields` and `Salutation` so an approval replays with the same values.
**When adding a field to a gated request, you must update three places together** — the snapshot DTO,
both places that build it, and `ApprovalAppService.ReplayAsync` — or an approved mutation silently
drops the new field on replay.

---

## 9. Invariants — the rules that must not break

1. **Server is the authority.** The browser copy is UX. Never delete the server check.
2. **Keep the two catalogs in sync.** `FieldPresets.cs` ↔ `fieldPresets.ts`. A preset id on one side
   with no twin on the other silently stops validating on whichever side was missed.
3. **Fail open on unknown preset ids.** A renamed/deleted preset must never block *every* submission
   on every field referencing it. Both sides do this; preserve it when adding a new kind.
4. **Core keys are locked.** `name`/`email`/`phoneNumber` must exist, keep `Core: true`, and nothing
   else may claim `Core`.
5. **Admin rules only ADD constraints on core fields.** They can make `name` reject digits; they can
   never make it optional or lift the 200-char cap.
6. **`null` ≠ `{}` for `customFields`.** `null` = untouched (preserve); `{}` = explicit wipe.
7. **Regex from admins is untrusted.** Always compile in `try/catch`, always with a timeout.
8. **Role and Status never enter this system.**

---

## 10. Gotchas that actually bit us

| Gotcha | Detail |
|---|---|
| **Stale doc comment** | `UserFieldSchemaAppService.GetAsync` says *"AuthDbSeeder seeds this row at startup"* — **it does not.** No seeding code exists. The row is created lazily on first `PUT`; until then `DefaultFields()` is the fallback. Harmless, but the comment is wrong. |
| **`userEvent.type` and `{`/`[`** | Testing-library parses them as key-sequence syntax. For a literal regex string use `fireEvent.change(el, { target: { value } })`. |
| **No accessible name on `<select>`** | A sibling `<span>` that *looks* like a label gives no accessible name. Query `getAllByRole('combobox')[n]` with a documented index. |
| **Split text nodes** | `"Internal ID: "` and the key render as separate nodes — exact `getByText` fails; use a substring regex. |
| **Insert-only nav seeding** | Changing `SortOrder` in code doesn't move already-seeded rows. |
| **`dotnet ef migrations remove`** | Regenerates the model snapshot from the *previous* migration's designer file — on a merged branch this can silently drop another feature's entities. Verify the snapshot after. |
| **Locked `apphost.exe`** | If the service is running, `dotnet build` fails. Stop it, or `dotnet test -o ./bin/TestRunTemp` (keep `-o` *inside* the repo). |

---

## 11. Redo checklist

```
[ ]  1. Entities: UserFieldSchema, ValidationPresetCatalog, SalutationCatalog
[ ]  2. User.cs: + Salutation, + ExtraAttributes
[ ]  3. AuthDbContext: 3 DbSets + 4 × .HasColumnType("jsonb")
[ ]  4. dotnet ef migrations add  (×3)
[ ]  5. DTOs: UserFieldSchemaDtos / ValidationPresetDtos / SalutationDtos
[ ]  6. FieldPresets.cs + EmailSmartValidator.cs
[ ]  7. UserSchemaValidator.cs           ← server authority
[ ]  8. 3 × AppService (Get/Update + ValidateShape)
[ ]  9. 3 × Controller, reusing host.settings.users
[ ] 10. Program.cs: 4 registrations
[ ] 11. UserAppService: ValidateAndBuildExtraAttributesAsync + null-preserve
[ ] 12. FieldValidationException + AppExceptionFilter fieldErrors
[ ] 13. packages/ui: ajv + ajv-formats, fieldPresets.ts, schemaValidation.ts, index.ts exports
[ ] 14. 3 × frontend api client
[ ] 15. ManageFieldsPage / ManageFormatsPage + 3 components
[ ] 16. UserFormLayer: schema-driven rendering
[ ] 17. usersApi types, UserDetailPage, ProfilePage, Topbar, DashboardPage
[ ] 18. App.tsx routes + AuthDbSeeder nav rows
[ ] 19. Tests both sides
```

**Verify:** `GET /api/user-schema` returns the three core fields → `PUT` deleting `email` is rejected →
add an Aadhar field → Create User shows it → submit an invalid value and confirm a **400 with
`fieldErrors`** (not a browser-only rejection) → valid submit lands name/email/phone in columns and
Aadhar in `ExtraAttributes`.

---

## 12. Complete file-by-file code reference

Every file in the system, full and unabridged, grouped by layer. Files whose complete code already
appears in §5 (`UserFieldSchema.cs`, `UserFieldSchemaAppService.cs`, `UserSchemaValidator.cs`,
`UserSchemaController.cs`, the DTO/exception/App.tsx/AuthDbSeeder snippets) are not repeated here —
jump back to §5 for those. This section covers everything else, so between the two, no file in the
system is left unshown.

### 12.1 Backend — the other two catalogs (Manage Formats, Salutations)

These are structurally identical to `UserFieldSchema`/`UserFieldSchemaAppService` — same
Get/GetAsync-fallback/Update/`Version += 1` shape — which is why they were fast to build once the first
one existed. Read them side by side with §5 to see the pattern repeat.

**`Backend/AuthService/Domain/Entities/ValidationPresetCatalog.cs`**

```csharp
public class ValidationPresetCatalog
{
    public Guid Id { get; set; }
    public required string PresetsJson { get; set; }
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
```

**`Backend/AuthService/Domain/Entities/SalutationCatalog.cs`** — identical shape, `SalutationsJson`.

**`Backend/AuthService/Application/DTOs/ValidationPresetDtos.cs`**

```csharp
/// `Kind` says which other fields are meaningful:
///  - "regex": Pattern is used.
///  - "lengthRange": MinLength/MaxLength bound character count (either may be null = open-ended).
///  - "numericRange": MinValue/MaxValue bound the value parsed as a number (either may be null).
///  - "textPattern": TextMode picks a character-class constraint — the "no-regex" option.
public record CustomPresetDto(
    string Key, string Label, string Kind, string? Pattern,
    int? MinLength, int? MaxLength, decimal? MinValue, decimal? MaxValue,
    string Message, string? TextMode = null);

public record ValidationPresetCatalogDto(IReadOnlyList<CustomPresetDto> Presets, int Version, DateTimeOffset UpdatedAt);
public record UpdateValidationPresetCatalogRequest(IReadOnlyList<CustomPresetDto> Presets);
```

**`Backend/AuthService/Application/DTOs/SalutationDtos.cs`**

```csharp
public record SalutationCatalogDto(IReadOnlyList<string> Salutations, int Version, DateTimeOffset UpdatedAt);
public record UpdateSalutationCatalogRequest(IReadOnlyList<string> Salutations);
```

**`Backend/AuthService/Application/Services/ValidationPresetAppService.cs`** — the one with the most
guard logic, because a custom format has four different shapes to validate:

```csharp
public class ValidationPresetAppService(AuthDbContext db)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public const string KindRegex = FieldPresets.CustomPresetKindRegex;
    public const string KindLengthRange = FieldPresets.CustomPresetKindLengthRange;
    public const string KindNumericRange = FieldPresets.CustomPresetKindNumericRange;
    public const string KindTextPattern = FieldPresets.CustomPresetKindTextPattern;
    private static readonly HashSet<string> ValidKinds = [KindRegex, KindLengthRange, KindNumericRange, KindTextPattern];

    // A custom format can never reuse a built-in preset's id — would make a field's rule ambiguous
    // about which catalog it came from.
    private static readonly HashSet<string> ReservedBuiltinKeys =
    [
        FieldPresets.LettersOnly, FieldPresets.LettersAndSpaces, FieldPresets.Alphanumeric,
        FieldPresets.NoSpecialCharacters, FieldPresets.DigitsOnly, FieldPresets.AadharFormat,
        FieldPresets.PanFormat, FieldPresets.Pincode, FieldPresets.Url, FieldPresets.EmailSmart,
        FieldPresets.MobileIN, FieldPresets.MinLength, FieldPresets.MaxLength, FieldPresets.ExactLength,
        FieldPresets.Custom,
    ];

    public async Task<ValidationPresetCatalogDto> GetAsync(CancellationToken ct = default)
    {
        var row = await db.ValidationPresetCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        if (row is null) return new ValidationPresetCatalogDto([], 0, DateTimeOffset.UtcNow);
        var presets = JsonSerializer.Deserialize<List<CustomPresetDto>>(row.PresetsJson, JsonOptions) ?? [];
        return new ValidationPresetCatalogDto(presets, row.Version, row.UpdatedAt);
    }

    public async Task<IReadOnlyList<CustomPresetDto>> GetPresetsAsync(CancellationToken ct = default)
        => (await GetAsync(ct)).Presets;

    public async Task<ValidationPresetCatalogDto> UpdateAsync(
        UpdateValidationPresetCatalogRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        ValidateShape(request.Presets);
        var row = await db.ValidationPresetCatalogs.OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var presetsJson = JsonSerializer.Serialize(request.Presets, JsonOptions);

        if (row is null)
        {
            row = new ValidationPresetCatalog { Id = Guid.NewGuid(), PresetsJson = presetsJson, Version = 1, UpdatedAt = now, UpdatedBy = actingUserId };
            db.ValidationPresetCatalogs.Add(row);
        }
        else
        {
            row.PresetsJson = presetsJson; row.Version += 1; row.UpdatedAt = now; row.UpdatedBy = actingUserId;
        }

        await db.SaveChangesAsync(ct);
        return new ValidationPresetCatalogDto(request.Presets, row.Version, row.UpdatedAt);
    }

    private static void ValidateShape(IReadOnlyList<CustomPresetDto> presets)
    {
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var preset in presets)
        {
            if (string.IsNullOrWhiteSpace(preset.Key) || string.IsNullOrWhiteSpace(preset.Label))
                throw new ValidationAppException("Every format needs a label.");
            if (!keys.Add(preset.Key))
                throw new ValidationAppException($"Format key '{preset.Key}' is used more than once.");
            if (ReservedBuiltinKeys.Contains(preset.Key))
                throw new ValidationAppException($"'{preset.Key}' is a reserved built-in format name.");
            if (!ValidKinds.Contains(preset.Kind))
                throw new ValidationAppException($"'{preset.Label}' has an unknown format type '{preset.Kind}'.");
            if (string.IsNullOrWhiteSpace(preset.Message))
                throw new ValidationAppException($"'{preset.Label}' needs an error message.");

            switch (preset.Kind)
            {
                case KindRegex:
                    if (string.IsNullOrWhiteSpace(preset.Pattern))
                        throw new ValidationAppException($"'{preset.Label}' needs a regular expression.");
                    try { _ = new Regex(preset.Pattern); }
                    catch (ArgumentException) { throw new ValidationAppException($"'{preset.Label}' has an invalid regular expression: {preset.Pattern}"); }
                    break;
                case KindLengthRange:
                    if (preset.MinLength is null && preset.MaxLength is null)
                        throw new ValidationAppException($"'{preset.Label}' needs a minimum and/or maximum length.");
                    if (preset.MinLength is not null && preset.MaxLength is not null && preset.MinLength > preset.MaxLength)
                        throw new ValidationAppException($"'{preset.Label}': minimum length cannot exceed maximum length.");
                    break;
                case KindNumericRange:
                    if (preset.MinValue is null && preset.MaxValue is null)
                        throw new ValidationAppException($"'{preset.Label}' needs a minimum and/or maximum value.");
                    if (preset.MinValue is not null && preset.MaxValue is not null && preset.MinValue > preset.MaxValue)
                        throw new ValidationAppException($"'{preset.Label}': minimum value cannot exceed maximum value.");
                    break;
                case KindTextPattern:
                    if (string.IsNullOrWhiteSpace(preset.TextMode) || !FieldPresets.TextPatternModes.Contains(preset.TextMode))
                        throw new ValidationAppException($"'{preset.Label}' needs a valid character type selected.");
                    break;
            }
        }
    }
}
```

**`Backend/AuthService/Application/Services/SalutationAppService.cs`** — the simplest of the three;
salutations are just a deduplicated string list:

```csharp
public class SalutationAppService(AuthDbContext db)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string[] DefaultSalutations = ["Mr.", "Ms.", "Mrs.", "Dr."];

    public async Task<SalutationCatalogDto> GetAsync(CancellationToken ct = default)
    {
        var row = await db.SalutationCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        if (row is null) return new SalutationCatalogDto(DefaultSalutations, 0, DateTimeOffset.UtcNow);
        var salutations = JsonSerializer.Deserialize<List<string>>(row.SalutationsJson, JsonOptions) ?? [];
        return new SalutationCatalogDto(salutations, row.Version, row.UpdatedAt);
    }

    public async Task<IReadOnlyList<string>> GetSalutationsAsync(CancellationToken ct = default)
        => (await GetAsync(ct)).Salutations;

    public async Task<SalutationCatalogDto> UpdateAsync(
        UpdateSalutationCatalogRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        var cleaned = ValidateShape(request.Salutations);
        var row = await db.SalutationCatalogs.OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var json = JsonSerializer.Serialize(cleaned, JsonOptions);

        if (row is null)
        {
            row = new SalutationCatalog { Id = Guid.NewGuid(), SalutationsJson = json, Version = 1, UpdatedAt = now, UpdatedBy = actingUserId };
            db.SalutationCatalogs.Add(row);
        }
        else { row.SalutationsJson = json; row.Version += 1; row.UpdatedAt = now; row.UpdatedBy = actingUserId; }

        await db.SaveChangesAsync(ct);
        return new SalutationCatalogDto(cleaned, row.Version, row.UpdatedAt);
    }

    private static List<string> ValidateShape(IReadOnlyList<string> salutations)
    {
        var cleaned = salutations.Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
        if (cleaned.Count == 0) throw new ValidationAppException("At least one salutation is required.");
        if (cleaned.Any(s => s.Length > 20)) throw new ValidationAppException("A salutation cannot exceed 20 characters.");
        var distinct = new HashSet<string>(cleaned, StringComparer.OrdinalIgnoreCase);
        if (distinct.Count != cleaned.Count) throw new ValidationAppException("The salutation list has a duplicate entry.");
        return cleaned;
    }
}
```

**`Backend/AuthService/Controllers/ValidationPresetsController.cs`** and **`SalutationsController.cs`**
— both the exact same 30-line shape as `UserSchemaController` (see §5 step 5): `[Authorize]`,
`[RequirePermission(HostFeatureKeys.SettingsUsers, "View"|"Edit")]` on `GET`/`PUT`, a
`CurrentUserId()` helper reading the JWT `sub` claim. Routes are `/api/validation-presets` and
`/api/salutations` respectively.

### 12.2 Backend — the shared validation primitives

**`Backend/AuthService/Infrastructure/Validation/FieldPresets.cs`** — full file. This is *data*, not
logic: every preset id as a constant, and a lookup table for the ones that are "just a regex":

```csharp
public static class FieldPresets
{
    public const string LettersOnly = "lettersOnly";
    public const string LettersAndSpaces = "lettersAndSpaces";
    public const string Alphanumeric = "alphanumeric";
    public const string NoSpecialCharacters = "noSpecialCharacters";
    public const string AadharFormat = "aadharFormat";
    public const string PanFormat = "panFormat";
    public const string Pincode = "pincode";
    public const string Url = "url";
    public const string EmailSmart = "emailSmart";
    public const string MobileIN = "mobileIN";
    public const string MinLength = "minLength";
    public const string MaxLength = "maxLength";
    public const string ExactLength = "exactLength";
    public const string DigitsOnly = "digitsOnly";
    public const string Custom = "custom";

    public const string CustomPresetKindRegex = "regex";
    public const string CustomPresetKindLengthRange = "lengthRange";
    public const string CustomPresetKindNumericRange = "numericRange";
    public const string CustomPresetKindTextPattern = "textPattern";

    public static readonly IReadOnlyList<string> TextPatternModes =
        [LettersOnly, LettersAndSpaces, Alphanumeric, NoSpecialCharacters, DigitsOnly];

    private static readonly IReadOnlyDictionary<string, Regex> RegexPresets = new Dictionary<string, Regex>
    {
        [LettersOnly] = new("^[A-Za-z]+$", RegexOptions.Compiled),
        [LettersAndSpaces] = new("^[A-Za-z ]+$", RegexOptions.Compiled),
        [Alphanumeric] = new("^[A-Za-z0-9]+$", RegexOptions.Compiled),
        [NoSpecialCharacters] = new(@"^[A-Za-z0-9 ]+$", RegexOptions.Compiled),
        [DigitsOnly] = new(@"^[0-9]+$", RegexOptions.Compiled),
        [AadharFormat] = new(@"^\d{4}\s?\d{4}\s?\d{4}$", RegexOptions.Compiled),   // "1234 5678 9012"
        [PanFormat] = new("^[A-Z]{5}[0-9]{4}[A-Z]$", RegexOptions.Compiled),
        [Pincode] = new(@"^\d{6}$", RegexOptions.Compiled),
    };

    public static bool TryGetRegex(string presetId, out Regex regex) => RegexPresets.TryGetValue(presetId, out regex!);

    // Reuses the exact shape CreateUserRequest/UpdateUserRequest already enforce on PhoneNumber via
    // data annotation, so "the default mobile rule" means one thing in the whole service.
    public static readonly Regex MobileInDefaultShape = new(@"^(?=(?:\D*\d){7,15}\D*$)[0-9+()\-.\s]+$", RegexOptions.Compiled);

    public static bool IsAbsoluteUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
}
```

**`Backend/AuthService/Infrastructure/Validation/EmailSmartValidator.cs`** — full file. The one preset
that's genuine C# logic rather than a regex, because "is this email a typo of a common provider" is a
judgement call:

```csharp
public static class EmailSmartValidator
{
    private static readonly Regex EmailShape = new(@"^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,24}$", RegexOptions.Compiled);

    private static readonly string[] CommonDomains =
    [
        "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com",
        "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "protonmail.com",
    ];

    public static bool IsValid(string value)
    {
        var trimmed = value.Trim();
        if (!EmailShape.IsMatch(trimmed)) return false;

        var atIndex = trimmed.LastIndexOf('@');
        var domain = trimmed[(atIndex + 1)..].ToLowerInvariant();

        if (CommonDomains.Contains(domain)) return true;

        // "gmial.com" or "gmail.comsssss" — starts with a known domain but isn't exactly it.
        var nearMiss = CommonDomains.Any(d => domain.StartsWith(d, StringComparison.Ordinal) && domain.Length > d.Length);
        return !nearMiss;
    }
}
```

### 12.3 Frontend — `@omniremit/ui` shared package

**`Frontend/packages/ui/src/validation/fieldPresets.ts`** — the exact TypeScript twin of
`FieldPresets.cs`, but shaped as data AJV can compile directly (`schema` fragments) rather than a C#
regex table:

```ts
export type PresetGroup = 'textShape' | 'format' | 'length' | 'custom'

export interface JsonSchemaPreset {
  id: string; kind: 'jsonSchema'; group: PresetGroup; label: string
  schema: Record<string, unknown>; defaultMessage: string
  example: { valid: string; invalid: string }
}
export interface BuiltinPreset {
  id: string; kind: 'builtin'; group: PresetGroup; label: string
  defaultMessage: string; example: { valid: string; invalid: string }
}
export type FieldPreset = JsonSchemaPreset | BuiltinPreset
export const CUSTOM_PRESET_ID = 'custom'

export const FIELD_PRESETS: FieldPreset[] = [
  { id: 'lettersOnly', kind: 'jsonSchema', group: 'textShape', label: 'Letters only',
    schema: { pattern: '^[A-Za-z]+$' }, defaultMessage: 'Only letters are allowed.',
    example: { valid: 'Jane', invalid: 'Jane2' } },
  { id: 'lettersAndSpaces', kind: 'jsonSchema', group: 'textShape', label: 'Letters & spaces',
    schema: { pattern: '^[A-Za-z ]+$' }, defaultMessage: 'Only letters and spaces are allowed.',
    example: { valid: 'Jane Smith', invalid: 'Jane Smith2' } },
  { id: 'alphanumeric', kind: 'jsonSchema', group: 'textShape', label: 'Alphanumeric',
    schema: { pattern: '^[A-Za-z0-9]+$' }, defaultMessage: 'Only letters and numbers are allowed.',
    example: { valid: 'EMP1234', invalid: 'EMP-1234' } },
  { id: 'noSpecialCharacters', kind: 'jsonSchema', group: 'textShape', label: 'No special characters',
    schema: { pattern: '^[A-Za-z0-9 ]+$' }, defaultMessage: 'Special characters are not allowed.',
    example: { valid: 'Room 4B', invalid: 'Room #4B!' } },
  { id: 'digitsOnly', kind: 'jsonSchema', group: 'textShape', label: 'Digits only',
    schema: { pattern: '^[0-9]+$' }, defaultMessage: 'Only digits are allowed.',
    example: { valid: '12345', invalid: '123-45' } },

  // Builtin presets delegate to already-tested, non-regex logic instead of reimplementing it:
  { id: 'emailSmart', kind: 'builtin', group: 'format', label: 'Email address',
    defaultMessage: 'Enter a valid email address.', example: { valid: 'jane@example.com', invalid: 'jane@example' } },
  { id: 'mobileIN', kind: 'builtin', group: 'format', label: 'Mobile number',
    defaultMessage: 'Enter a valid mobile number.', example: { valid: '+91 98765 43210', invalid: '12' } },

  { id: 'aadharFormat', kind: 'jsonSchema', group: 'format', label: 'Aadhar number',
    schema: { pattern: '^\\d{4}\\s?\\d{4}\\s?\\d{4}$' }, defaultMessage: 'Enter a valid 12-digit Aadhar number.',
    example: { valid: '1234 5678 9012', invalid: '1234-5678' } },
  { id: 'panFormat', kind: 'jsonSchema', group: 'format', label: 'PAN number',
    schema: { pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' }, defaultMessage: 'Enter a valid PAN number (e.g. ABCDE1234F).',
    example: { valid: 'ABCDE1234F', invalid: 'ABCDE1234' } },
  { id: 'pincode', kind: 'jsonSchema', group: 'format', label: 'Pincode',
    schema: { pattern: '^\\d{6}$' }, defaultMessage: 'Enter a valid 6-digit pincode.',
    example: { valid: '400001', invalid: '4000' } },
  { id: 'url', kind: 'jsonSchema', group: 'format', label: 'Website URL',
    schema: { format: 'uri' }, defaultMessage: 'Enter a valid URL, e.g. https://example.com',
    example: { valid: 'https://example.com', invalid: 'example' } },

  { id: 'minLength', kind: 'jsonSchema', group: 'length', label: 'Minimum length',
    schema: { minLength: 1 }, defaultMessage: 'This value is too short.', example: { valid: 'Abcdef', invalid: 'Ab' } },
  { id: 'maxLength', kind: 'jsonSchema', group: 'length', label: 'Maximum length',
    schema: { maxLength: 1 }, defaultMessage: 'This value is too long.', example: { valid: 'Ab', invalid: 'Abcdef' } },
  { id: 'exactLength', kind: 'jsonSchema', group: 'length', label: 'Exact length',
    schema: { minLength: 1, maxLength: 1 }, defaultMessage: 'This value must be a specific length.',
    example: { valid: 'Abcdef', invalid: 'Ab' } },
]

export function findPreset(id: string): FieldPreset | undefined {
  return FIELD_PRESETS.find((p) => p.id === id)
}

export const PRESET_GROUP_LABELS: Record<PresetGroup, string> = {
  textShape: 'Text shape', format: 'Format', length: 'Length', custom: 'Custom',
}
```

> Note `minLength`/`maxLength`/`exactLength` ship with a dummy bound (`1`) baked into their `schema` —
> that value is never actually used. Both `FieldEditorModal` (below) and `UserSchemaValidator.cs`
> read the *rule's own* `.value`/`.Value`, not the preset's `schema`, for these three. The preset
> entry exists only to put the option in the dropdown with the right label/group.

`schemaValidation.ts` was shown in full in §5 step 8 — that's the AJV engine these presets feed into.

### 12.4 Frontend — the three API clients

All three are the same four-line shape: a typed `GET` and a typed `PUT`, both going through the
shared `apiFetch` helper (`shared/api/httpClient.ts`), which attaches the bearer token and throws
`ApiError` on a non-2xx response.

**`Frontend/apps/host/src/features/settings-user-fields/api/userSchemaApi.ts`**

```ts
import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import type { FieldDefinition } from '@omniremit/ui/validation'

const base = env.authServiceUrl

export interface UserFieldSchemaDto { fields: FieldDefinition[]; version: number; updatedAt: string }
export interface UpdateUserFieldSchemaRequest { fields: FieldDefinition[] }

export const userSchemaApi = {
  get: (accessToken: string) => apiFetch<UserFieldSchemaDto>(`${base}/api/user-schema`, { accessToken }),
  update: (accessToken: string, body: UpdateUserFieldSchemaRequest) =>
    apiFetch<UserFieldSchemaDto>(`${base}/api/user-schema`, { method: 'PUT', accessToken, body }),
}
```

**`customPresetsApi.ts`** — identical shape against `/api/validation-presets`, typed with `CustomPreset[]`.

**`salutationsApi.ts`** — identical shape against `/api/salutations`, typed with `string[]`.

### 12.5 Frontend — the admin screens

**`Frontend/apps/host/src/features/settings-user-fields/pages/ManageFieldsPage.tsx`** — full file
(minus CSS-module class names, which carry no logic):

```tsx
export function ManageFieldsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')

  const [fields, setFields] = useState<FieldDefinition[]>([])
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editorState, setEditorState] = useState<{ open: boolean; field: FieldDefinition | null }>({ open: false, field: null })

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [schemaRes, presetsRes] = await Promise.all([
          userSchemaApi.get(accessToken!),
          customPresetsApi.get(accessToken!),
        ])
        if (cancelled) return
        setFields([...schemaRes.fields].sort((a, b) => a.order - b.order))
        setCustomPresets(presetsRes.presets)
        setDirty(false)
      } catch (err) { /* setError(...) */ }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [accessToken])

  // Every add/remove/reorder touches ONLY this in-memory array — nothing reaches the server until
  // "Save Changes". order is recomputed from array position every time, so the admin never edits a
  // number directly; the list's visual order IS the order.
  function withOrder(list: FieldDefinition[]): FieldDefinition[] {
    return list.map((f, i) => ({ ...f, order: i + 1 }))
  }

  function handleSaveField(field: FieldDefinition) {
    setFields((prev) => {
      const exists = prev.some((f) => f.key === field.key)
      const next = exists ? prev.map((f) => (f.key === field.key ? field : f)) : [...prev, field]
      return withOrder(next)
    })
    setDirty(true)
    setEditorState({ open: false, field: null })
  }

  function handleRemove(key: string) {
    setFields((prev) => withOrder(prev.filter((f) => f.key !== key)))
    setDirty(true)
  }

  async function handleSaveChanges() {
    if (!accessToken) return
    setSaving(true)
    try {
      const res = await userSchemaApi.update(accessToken, { fields })   // PUT /api/user-schema
      setFields([...res.fields].sort((a, b) => a.order - b.order))
      setDirty(false)
      toast.success('User fields updated. The Create/Edit User form now reflects these changes.')
    } catch (err) { toast.error(...) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <PageHeader title="Manage Fields" subtitle="Choose which fields appear on the Create/Edit User form..." />
      <SalutationsCard canEdit={canEdit} />
      <div>
        {/* header + "+ Add Field" button, only when canEdit */}
        {fields.map((field) => (
          <div key={field.key}>
            <span>{field.label}</span>
            {field.core && <span>Core</span>}
            {field.required && <span>Required</span>}
            <span>
              {field.validations.length === 0
                ? 'No extra validation — any value is accepted.'
                : field.validations.map((v) => v.message).join(' · ')}
            </span>
            {canEdit && <button onClick={() => setEditorState({ open: true, field })}>Edit</button>}
            {canEdit && !field.core && <button onClick={() => handleRemove(field.key)}>Delete</button>}
          </div>
        ))}
        {canEdit && (
          <div>
            <span>{dirty ? 'You have unsaved changes.' : 'Changes take effect the next time someone opens Create User.'}</span>
            <Button loading={saving} disabled={!dirty} onClick={handleSaveChanges}>Save Changes</Button>
          </div>
        )}
      </div>
      <FieldEditorModal
        open={editorState.open} field={editorState.field}
        existingKeys={fields.map((f) => f.key)} customPresets={customPresets}
        onSave={handleSaveField} onClose={() => setEditorState({ open: false, field: null })}
      />
    </div>
  )
}
```

**`ManageFormatsPage.tsx`** — the same list/modal/Save-Changes shape as above, targeting
`customPresetsApi` instead, plus a **second, read-only card** at the top that renders `FIELD_PRESETS`
(the fixed catalog) grouped by `PRESET_GROUP_LABELS`, so this page shows *everything* the "Add
Validation Rule" dropdown can offer — built-in and admin-defined — in one place:

```tsx
const [presets, setPresets] = useState<CustomPreset[]>([])
// ... identical load/save/dirty pattern to ManageFieldsPage, against customPresetsApi ...

function summarize(preset: CustomPreset): string {
  switch (preset.kind) {
    case 'regex': return preset.pattern ? `Pattern: ${preset.pattern}` : 'No pattern set.'
    case 'lengthRange':
      if (preset.minLength != null && preset.maxLength != null) return `${preset.minLength}–${preset.maxLength} characters`
      if (preset.minLength != null) return `At least ${preset.minLength} characters`
      if (preset.maxLength != null) return `At most ${preset.maxLength} characters`
      return 'No length bounds set.'
    case 'numericRange': /* same three-way pattern for MinValue/MaxValue */
    case 'textPattern': return preset.textMode ? `Character type: ${preset.textMode}` : 'No character type set.'
  }
}

// Built-in card — read-only, sourced from the same FIELD_PRESETS constant FieldEditorModal reads:
{(['textShape', 'format', 'length'] as const).map((group) => (
  <div key={group}>
    <span>{PRESET_GROUP_LABELS[group]}</span>
    {FIELD_PRESETS.filter((p) => p.group === group).map((p) => <span key={p.id} title={p.defaultMessage}>{p.label}</span>)}
  </div>
))}
```

**`components/FieldEditorModal.tsx`** — full file. This is the most interesting piece of frontend
logic in the system: label → key derivation, rule stacking, and the live tester.

```tsx
function slugify(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const [first, ...rest] = words
  const clean = (w: string) => w.replace(/[^a-zA-Z0-9]/g, '')
  return clean(first).toLowerCase() +
    rest.map((w) => { const c = clean(w); return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase() }).join('')
}
// "Aadhar Number" -> "aadharNumber". Runs on every keystroke via useMemo; the admin never types a key.

let ruleIdCounter = 0
function nextRuleId() { ruleIdCounter += 1; return `rule-${ruleIdCounter}` }
// A React list key + editing handle for one rule card. Never sent to the server — stripped in handleSave.

export function FieldEditorModal({ open, field, existingKeys, customPresets, onSave, onClose }) {
  const isEdit = field !== null
  const isCore = field?.core ?? false

  const [label, setLabel] = useState('')
  const [required, setRequired] = useState(true)
  const [rules, setRules] = useState<(ValidationRule & { _id: string })[]>([])
  const [addRuleChoice, setAddRuleChoice] = useState('')
  const [testValues, setTestValues] = useState<Record<string, string>>({})

  // Re-seed all local state from `field` every time the modal opens — Add and Edit are the SAME modal,
  // distinguished only by whether `field` is null.
  useEffect(() => {
    if (!open) return
    setLabel(field?.label ?? '')
    setRequired(field?.required ?? true)
    setRules((field?.validations ?? []).map((r) => ({ ...r, _id: nextRuleId() })))
    setAddRuleChoice(''); setTestValues({})
  }, [open, field])

  const key = useMemo(() => field?.key ?? slugify(label), [field, label])   // locked once editing

  // A preset already added can't be added twice — filtered out of the dropdown, not merely disabled.
  const availablePresets = useMemo(() => FIELD_PRESETS.filter((p) => !rules.some((r) => r.type === p.id)), [rules])
  const availableCustomPresets = useMemo(() => customPresets.filter((p) => !rules.some((r) => r.type === p.key)), [customPresets, rules])

  function addRule(presetId: string) {
    if (!presetId) return
    if (presetId === CUSTOM_PRESET_ID) {
      setRules((prev) => [...prev, { _id: nextRuleId(), type: CUSTOM_PRESET_ID, pattern: '', message: 'Enter a valid value.' }])
      setAddRuleChoice(''); return
    }
    const customPreset = customPresets.find((p) => p.key === presetId)
    if (customPreset) {
      setRules((prev) => [...prev, { _id: nextRuleId(), type: customPreset.key, message: customPreset.message }])
      setAddRuleChoice(''); return
    }
    const preset = findPreset(presetId)
    if (!preset) return
    const rule = { _id: nextRuleId(), type: preset.id, message: preset.defaultMessage }
    if (['minLength', 'maxLength', 'exactLength'].includes(preset.id)) {
      rule.value = preset.id === 'minLength' ? 2 : preset.id === 'maxLength' ? 50 : 10   // sane defaults
    }
    setRules((prev) => [...prev, rule]); setAddRuleChoice('')
  }

  function handleSave() {
    if (!label.trim()) { setError('Label is required.'); return }
    if (!isEdit) {
      if (!key) { setError('Enter a label made of letters — an internal key could not be derived from it.'); return }
      if (existingKeys.includes(key)) { setError('A field with this internal key already exists...'); return }
    }
    for (const rule of rules) {
      if (rule.type === CUSTOM_PRESET_ID) {
        if (!rule.pattern?.trim()) { setError('Every custom pattern rule needs a regular expression.'); return }
        try { new RegExp(rule.pattern) } catch { setError(`"${rule.pattern}" is not valid regular expression syntax.`); return }
      }
    }
    const cleanRules = rules.map(({ _id, ...r }) => r)   // strip the React-only id before it ever leaves the modal
    onSave({ key, label: label.trim(), core: isCore, dataType: field?.dataType ?? 'text', required, order: field?.order ?? 0, validations: cleanRules })
  }

  // ...render: label input -> Internal ID hint -> Required toggle (forced on + disabled for core) ->
  // one card per rule (pattern/value/message inputs conditional on rule.type, live tester wired to
  // testRule() from schemaValidation.ts) -> grouped <select> to add the next rule.
}
```

**`components/FormatEditorModal.tsx`** — the Manage Formats twin, same `slugify`/live-tester shape,
but its `buildPreset()` assembles a `CustomPreset` whose fields depend on the chosen `kind` (only one
of `pattern` / `minLength`+`maxLength` / `minValue`+`maxValue` / `textMode` is ever populated):

```tsx
function buildPreset(): CustomPreset {
  return {
    key, label: label.trim(), kind,
    pattern: kind === 'regex' ? pattern.trim() : undefined,
    minLength: kind === 'lengthRange' && minLength !== '' ? Number(minLength) : undefined,
    maxLength: kind === 'lengthRange' && maxLength !== '' ? Number(maxLength) : undefined,
    minValue: kind === 'numericRange' && minValue !== '' ? Number(minValue) : undefined,
    maxValue: kind === 'numericRange' && maxValue !== '' ? Number(maxValue) : undefined,
    textMode: kind === 'textPattern' ? textMode : undefined,
    message: message.trim(),
  }
}
const testResult = testValue ? testCustomPreset(buildPreset(), testValue) : null   // re-evaluated on every keystroke
```

`handleSave` mirrors `ValidationPresetAppService.ValidateShape` on the client — same four `switch`
branches, same messages — so a mistake is caught before the round trip, then caught *again* server-side
if the client check is ever bypassed.

**`components/SalutationsCard.tsx`** — full file, the simplest of the three editors (a chip list, no
modal):

```tsx
export function SalutationsCard({ canEdit }: SalutationsCardProps) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const [salutations, setSalutations] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [newValue, setNewValue] = useState('')

  useEffect(() => {
    if (!accessToken) return
    salutationsApi.get(accessToken).then((res) => setSalutations(res.salutations)) /* ...catch/finally... */
  }, [accessToken])

  function addSalutation() {
    const trimmed = newValue.trim()
    if (!trimmed) return
    if (salutations.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already in the list.`); return
    }
    setSalutations((prev) => [...prev, trimmed]); setNewValue(''); setDirty(true)
  }

  function removeSalutation(value: string) {
    setSalutations((prev) => prev.filter((s) => s !== value)); setDirty(true)
  }

  async function handleSave() {
    const res = await salutationsApi.update(accessToken, { salutations })   // PUT /api/salutations
    setSalutations(res.salutations); setDirty(false)
    toast.success('Salutations updated. They now appear on Create/Edit User and on profiles.')
  }

  // render: chip per salutation with a remove (x) button when canEdit, an input + Add button that
  // also submits on Enter, and a Save Changes button disabled until `dirty`.
}
```

### 12.6 Frontend — the consumer (`UserFormLayer.tsx`)

The three relevant slices of the Create/Edit User form, in the order they execute.

**Loading** (inside the form's main `useEffect`, fires once on mount / whenever `userId` changes):

```tsx
const [rolesRes, catalogRes, appsRes, schemaRes, salutationsRes] = await Promise.all([
  rolesApi.list(accessToken!, { pageSize: 100 }),
  permissionsApi.catalog(accessToken!),
  remoteAppsApi.list(accessToken!, { pageSize: 100 }),
  userSchemaApi.get(accessToken!),        // ← GET /api/user-schema
  salutationsApi.get(accessToken!),       // ← GET /api/salutations
])

const sortedFields = [...schemaRes.fields].sort((a, b) => a.order - b.order)
setFields(sortedFields)
// Every field starts blank; a userId load below overwrites core + custom values on top.
setFieldValues(Object.fromEntries(sortedFields.map((f) => [f.key, ''])))

if (userId) {
  const [userRes, overridesRes] = await Promise.all([
    usersApi.get(accessToken!, userId),
    usersApi.getOverrides(accessToken!, userId).catch(() => []),
  ])
  setFieldValues((prev) => ({
    ...prev,
    name: userRes.name, email: userRes.email, phoneNumber: userRes.phoneNumber ?? '',
    ...(userRes.customFields ?? {}),      // ← Aadhar Number etc. layered on top of the blank map
  }))
  setSalutation(userRes.salutation ?? '')
  // ...roleId, isActive, permission-override reconstruction...
}
```

**Rendering** — one generic input per field, in schema order, with a hardcoded icon only for the three
recognisable core fields:

```tsx
{fields.map((field) => {
  const fieldIcon =
    field.key === 'name' ? <Icon.Users .../> :
    field.key === 'email' ? <Icon.FileText .../> :
    field.key === 'phoneNumber' ? <Icon.Activity .../> : null   // custom fields get no icon

  const input = (
    <input
      type={field.dataType === 'email' ? 'email' : 'text'}
      placeholder={field.key === 'phoneNumber' ? 'e.g. +91 98765 43210' : `Enter ${field.label}`}
      value={fieldValues[field.key] ?? ''}
      aria-invalid={Boolean(showError(field.key))}
      onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
      onBlur={() => setTouched((t) => ({ ...t, [field.key]: true }))}
    />
  )
  return <div key={field.key}><label>{field.label} {field.required && <span>*</span>}</label>{input}</div>
})}
```

`const fieldErrors = validateFields(fields, fieldValues)` runs on every render — this is the
`@omniremit/ui/validation` AJV engine from §5 step 8, called with the live field list and live values.

**Submitting** — split core columns from the custom-fields bag:

```tsx
const nameValue = (fieldValues.name ?? '').trim()
const emailValue = (fieldValues.email ?? '').trim()
const payloadPhoneNumber = (fieldValues.phoneNumber ?? '').trim() || null
const customFields = Object.fromEntries(
  fields.filter((f) => !f.core).map((f) => [f.key, (fieldValues[f.key] ?? '').trim()]),
)
// customFields is ALWAYS an object here (possibly {}), never omitted — every non-core field the
// schema currently defines gets an entry, even an empty string. This is what makes UserAppService's
// "null means untouched" branch never fire from THIS screen — see the callout at the end of §12.7.

await usersApi.create(token, { name: nameValue, email: emailValue, phoneNumber: payloadPhoneNumber,
  roleId: roleId || null, isActive, customFields, salutation: salutation || null }, computedOverrides)
```

### 12.7 Backend — the write path (`UserAppService.cs`)

Already shown in full in §5 step 6. One clarification worth making explicit here, because it only
becomes obvious once you've seen *both* callers:

> **Which caller actually triggers the `null`-preserve branch?** `UserFormLayer.tsx` (§12.6 above)
> always sends a full `customFields` object — every non-core field, even blank ones — so the create/edit
> **User** screen never hits it. The only caller that omits `customFields` from the request body
> entirely is `Frontend/apps/host/src/features/profile/pages/ProfilePage.tsx`'s own `usersApi.update`
> call (self-service "edit my profile", which has no custom-field UI at all). *That* omission is what
> deserializes to `request.CustomFields == null` on the server and takes the "keep existing
> `ExtraAttributes`" branch instead of the "replace with `{}`" branch. If you add a new caller of
> `usersApi.update`, decide deliberately which behaviour it needs — sending `{}` explicitly wipes
> custom fields; omitting the key preserves them.

---

## 13. Exact call sequence — every function, in order

Two traces, file:function at each hop. Useful when you need to set a breakpoint.

### 13.1 Admin adds a field and saves

```
FieldEditorModal.tsx      : handleSave()                         — validate label/key/regex client-side
ManageFieldsPage.tsx      : handleSaveField(field)                — merge into in-memory `fields[]`, order recomputed
ManageFieldsPage.tsx      : handleSaveChanges()                   — user clicks "Save Changes"
userSchemaApi.ts          : userSchemaApi.update(token, {fields}) — PUT /api/user-schema
  ↓ HTTP
UserSchemaController.cs   : Update(request)                       — [RequirePermission(SettingsUsers,"Edit")]
UserFieldSchemaAppService : UpdateAsync(request, actingUserId)
UserFieldSchemaAppService : ValidateShape(request.Fields)          — throws ValidationAppException on any guard failure
  (JsonSerializer.Serialize)                                       — List<FieldDefinitionDto> → SchemaJson string
AuthDbContext              : UserFieldSchemas.Add / row.Version += 1
  ↓ SaveChangesAsync
Postgres                   : UPDATE/INSERT "UserFieldSchemas" (SchemaJson jsonb, Version, UpdatedAt)
  ↑ response bubbles back up as UserFieldSchemaDto
ManageFieldsPage.tsx       : setFields(res.fields); toast.success(...)
```

### 13.2 Someone submits Create User with a custom field filled in

```
UserFormLayer.tsx         : useEffect load — userSchemaApi.get() + salutationsApi.get() (parallel)
  ↓ HTTP GET /api/user-schema
UserSchemaController.cs   : Get()  →  UserFieldSchemaAppService.GetAsync()  →  JSON.Deserialize(SchemaJson)
UserFormLayer.tsx         : setFields(sorted); setFieldValues({ ...blank map })
  (user types into inputs — onChange per field)
UserFormLayer.tsx         : validateFields(fields, fieldValues)   — @omniremit/ui, AJV, on every render
  (user clicks the wizard's final submit)
UserFormLayer.tsx         : handleSubmit()
  build customFields = { aadharNumber: "1234 5678 9012", ... }    — every non-core field, always present
usersApi.ts                : usersApi.create(token, { ...customFields, salutation })
  ↓ HTTP POST /api/users
UsersController.cs         : Create(request)   [not shown in this doc — see UserAppService.CreateAsync's caller]
UserAppService.cs           : CreateAsync(request, overrides, actingUserId)
UserAppService.cs           : ValidateAndBuildExtraAttributesAsync(name, email, phone, request.CustomFields)
  UserFieldSchemaAppService : GetFieldsAsync()        — current schema, again (server never trusts the client's copy)
  ValidationPresetAppService: GetPresetsAsync()        — current custom-format catalog
  (loop)                    : allowedCustomKeys filter — silently drop any key not in the CURRENT schema
UserSchemaValidator.cs      : Validate(fields, values, customPresets)
  (per field)                : EvaluateRule(rule, value, presetsByKey)
                                 → FieldPresets.* fixed cases, OR
                                 → customPresets lookup (admin catalog), OR
                                 → FieldPresets.TryGetRegex (fixed catalog fallback), OR
                                 → null (fail open — unknown preset id)
  if errors.Count > 0        : throw FieldValidationException(errors)
                                 ↓ (only on failure)
                               AppExceptionFilter.cs : catches it → 400 + problem.Extensions["fieldErrors"]
                                 ↓
                               UserFormLayer.tsx      : catches ApiError, shows the message(s) inline
  else                        : JsonSerializer.Serialize(extraAttributes) → returned as extraAttributesJson
UserAppService.cs            : new User { Name, Email, PhoneNumber, ExtraAttributes = extraAttributesJson, Salutation, ... }
AuthDbContext                 : Users.Add(user)  →  SaveChangesAsync()
Postgres                      : INSERT INTO "Users" (..., "ExtraAttributes" jsonb, "Salutation")
  ↑ 200 OK, CreateUserResponse
UserFormLayer.tsx              : toast.success(...); finish()
```

The **AJV pass in `UserFormLayer.tsx`** and the **`UserSchemaValidator.Validate` pass in
`UserAppService.CreateAsync`** are two separately-executed, independently-implemented runs of
conceptually the same rules — not one validation "shared" over the network. That duplication is
deliberate (§1, §9 invariant 1): the browser copy can always be bypassed, so the server copy is the one
that actually decides whether the row gets written.
