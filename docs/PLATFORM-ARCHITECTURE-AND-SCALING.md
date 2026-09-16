# OmniConnect — Platform Architecture & Scaling Design

> **How to read this document.** It is written in plain English, with a worked example for every idea.
> You do not need to know microservices theory to follow it. Section 1 restates what you asked for.
> Sections 2–3 explain where you are today and what the one core problem is. Sections 4–13 are the
> design. Section 14 breaks it into phases you can schedule. Section 15 lists every source.
>
> **Nothing in your code has been changed.** This is a design document only.

---

## Table of contents

| # | Section | Answers your requirement |
|---|---|---|
| 1 | [Your requirement, restated](#1-your-requirement-restated) | "first improve this prompt" |
| 2 | [Where you are today](#2-where-you-are-today-honest-assessment) | "analyse my full project current architecture" |
| 3 | [The one core problem](#3-the-one-core-problem) | — |
| 4 | [Target architecture](#4-target-architecture) | "design the system in proper scalable way" |
| 5 | [The Customer 360 Plug-In Contract](#5-the-customer-360-plug-in-contract) | "some standard so remote apps follow" |
| 6 | [Identity: one person, many sources](#6-identity-one-person-many-sources) | "L001 and C001, same gmail, one place" |
| 7 | [Event backbone (RabbitMQ + Outbox)](#7-event-backbone-rabbitmq--outbox) | "how we communicate between DBs" |
| 8 | [Unsubscribe without losing data](#8-unsubscribe-without-losing-data) | "dislink but not previous data" |
| 9 | [Recommendations / "Interested" section](#9-recommendations--the-interested-section) | "predict product recommendation" |
| 10 | [Human-readable IDs (L001, C001…)](#10-human-readable-ids-l001-c001) | "lead id generated as L001" |
| 11 | [Database strategy](#11-database-strategy) | "is current schema good to go or not" |
| 12 | [Removing single points of failure](#12-removing-single-points-of-failure) | "remove the one point of failure" |
| 13 | [Zero downtime](#13-zero-downtime) | "must have capability of zero down time" |
| 14 | [Phased roadmap](#14-phased-roadmap) | "will divide the task in phases" |
| 15 | [Sources](#15-sources) | "add the source from where you pick info" |

---

## 1. Your requirement, restated

You asked me to improve your prompt first. Here is what you actually need, written as 12 testable goals.
Use these as your acceptance criteria later.

| # | Goal | Done when… |
|---|---|---|
| R1 | **Notification Service** as its own service | Any service can request "send this message" and forget about it; sending never blocks business work |
| R2 | **Audit Log Service** as its own service | All audit rows live in one place; today the same thing is built 3 separate times |
| R3 | **Human-readable record IDs** | Lead shows `L001`, Case shows `C001`, guaranteed unique, safe when 5 copies of the service run at once |
| R4 | **Case links to customer by email** | Creating a case for `jane@gmail.com` attaches it to that person's existing profile automatically |
| R5 | **Multi-source customer creation** | A person can be *created* from Leads **or** Cases (or Marketplace). Neither is "the master" |
| R6 | **Same email = one profile** | `L001` (from Leads) and `C001` (from Cases) with the same Gmail show on **one** Customer 360 page |
| R7 | **Marketplace purchases on profile** | Buying a product shows in that person's profile |
| R8 | **"Interested" recommendations** | Profile shows products the person is likely to want, based on their activity |
| R9 | **Unsubscribe = unlink, not delete** | Disabling Case Management for a user hides case panels but keeps every historical row |
| R10 | **A standard any future app follows** | Adding "Insurance App" next year requires **zero** code change inside Customer 360 |
| R11 | **Survive one database failing** | One DB down degrades one feature, does not take down the platform |
| R12 | **Zero downtime** | You can deploy and migrate the schema during business hours without users noticing |

**One thing your original prompt did not separate, but must be:**
R3 (nice-looking IDs) and R6 (one profile for one person) sound related but are completely different
problems. `L001` and `C001` identify **records**. A person needs a **separate** identity. Mixing these
two up is the most common way this kind of system goes wrong. Section 6 explains why.

---

## 2. Where you are today (honest assessment)

Everything here was verified by reading your code, not assumed.

### 2.1 What is already right ✅

You have made two decisions that many teams get wrong, and you should not undo them:

**1. You already have database-per-service.** Four genuinely separate Neon Postgres databases:

| Service | Database | Port |
|---|---|---|
| AuthService | `authService` | 5155 |
| ModuleRegistry | `moduleRegistry` | 5200 |
| LeadService | `leadService` | 5046 |
| Customer360Service | `customer360Service` | 5059 |

This is the recommended pattern — each service's data is private to it, so services can change their
schema without breaking each other ([microservices.io — Database per service][s1]).

**2. You have zero foreign keys across databases.** Cross-service references are loose `Guid`/`string`
columns. This *feels* sloppy but is actually correct: a real foreign key between two services'
databases would permanently weld them together.

> ⚠️ One caveat: "loose" currently means *too* loose. `LeadService/Models/Entities/AuditLog.cs:17` is
> `public string UserId { get; set; } = "USR-1001";` — a **string**, with a hardcoded fake default. It
> should at minimum be a `Guid?` with no default.

### 2.2 What will stop you from scaling ❌

| # | Problem | Where | Why it matters |
|---|---|---|---|
| P1 | **No message queue at all** | Whole repo — zero hits for RabbitMQ/Kafka/MassTransit | Every service call is blocking HTTP. Nothing can happen in the background |
| P2 | **Approval calls hard-fail** | `AuthServiceClient` throws `ApprovalServiceUnavailableException` | **If AuthService is down, mutations stop in EVERY service.** Biggest SPOF you have |
| P3 | **Customer 360 stores no customer data** | `Customer360DbContext.cs` has only 2 tables: `field_configs`, `audit_logs` | There is nothing to attach a case or purchase *to* |
| P4 | **No canonical customer ID** | Individuals key on `phpr_id`/CIF, corporates on `brn`, products on `accountNo`, some on `nric` | Four different keys for the same person. Email is not a key at all |
| P5 | **No plug-in mechanism** | `Customer360.tsx` is **2361 lines** of hardcoded tabs | Every new app = editing this file. Directly blocks R10 |
| P6 | **Audit built 3 times** | `AuthService/Domain/Entities/AuditLog.cs`, `LeadService/Models/Entities/AuditLog.cs`, `Customer360Service/Models/AuditLog.cs` | Three shapes, three tables, no single view |
| P7 | **Lead IDs can collide** | `LeadService.cs:128` → `LEAD-{timestamp}-{Random(1000,9999)}` | No `UNIQUE` constraint. Two leads in the same second *can* clash silently |
| P8 | **No resilience patterns** | No Polly, no circuit breaker, no retry on any HTTP call | One slow service stalls its callers until the 10s timeout |
| P9 | **SignalR has no Redis backplane** | `AuthService/Program.cs:378` literally warns about this | Real-time updates break the moment you run 2 instances |
| P10 | **Secrets committed in plaintext** | `Backend/*/.env` **and** `appsettings.json` | Neon DB passwords, **the JWT RSA private key**, `Internal__ApiKey`, CRM secret — in a public GitHub repo |

> 🔴 **P10 is urgent and unrelated to scaling.** Anyone with the JWT private key can mint a valid
> admin token for your platform. Rotate these before anything else in this document.

### 2.3 Two traps in the current code

**Trap 1 — Models that look like tables but aren't.**
`Customer360Service/Models/Models.cs` (992 lines) declares `IndividualProfile`, `CustomerProduct`,
`Interaction` etc. with `[Table]` and `[Column]` attributes. They look persisted. **They are not
DbSets** — they are just shapes for parsing CRM JSON. Customer 360 stores no customer data at all.

**Trap 2 — "Interested Products" already exists but is fake.**
It is not a list. It is three scalar columns on the profile (`interestedProduct`,
`interestedProductName`, `interestedProductCategory`), rendered with
`rowKey={() => 'interested-product'}` — literally one hardcoded row. R8 is a genuine build, not an
enhancement.

### 2.4 Today's shape

```
                    ┌──────────────────────────────────┐
    Browser ───────►│  Host app (React, port 5173)     │
                    └───┬───────────────┬──────────────┘
              loads MF  │               │  loads MF
                        ▼               ▼
                  ┌──────────┐    ┌──────────────┐
                  │ lead_mf  │    │customer360_mf│
                  └────┬─────┘    └──────┬───────┘
                       │                 │
         ┌─────────────┼─────────────────┼──────────────┐
         ▼             ▼                 ▼              ▼
   ┌──────────┐  ┌───────────┐   ┌──────────────┐  ┌──────────────┐
   │AuthService│◄─┤LeadService│   │Customer360Svc│  │ModuleRegistry│
   │  :5155   │  │   :5046   │   │    :5059     │  │    :5200     │
   └─────┬────┘  └─────┬─────┘   └──────┬───────┘  └──────┬───────┘
         │             │                │                 │
      ┌──▼──┐       ┌──▼──┐          ┌──▼──┐           ┌──▼──┐
      │authDB│      │leadDB│         │c360DB│          │regDB│
      └─────┘       └─────┘          └──┬──┘           └─────┘
                                        │ live proxy (no storage)
                                        ▼
                                 ┌─────────────┐
                                 │ External CRM│  ← ALL customer data lives here
                                 └─────────────┘

   ═══► Every arrow between services is BLOCKING HTTP. No queue anywhere.
   ═══► AuthService down ⇒ every other service's writes fail.
```

---

## 3. The one core problem

Read this page even if you skip everything else.

**You cannot link anything to a customer, because inside OmniConnect a customer does not exist.**

Today a "customer" is whatever the external CRM returns when you search it. There is no row in any of
your databases that says "this is person #47". So when you ask:

> *"When we create a case with an email that exists in Customer 360, the case should link to that
> person's profile"*

…there is literally nothing to link **to**. And the external CRM does not even index by email — email
arrives on a *separate* `/v1/contactinfo` call, and the CRM's actual keys are CIF, NRIC and BRN.

This one gap causes almost every requirement to fail:

```
   No local customer identity
            │
            ├──► R4  case can't link to a person          ✗
            ├──► R5  lead/case can't create a person      ✗
            ├──► R6  L001 and C001 can't be the same one  ✗
            ├──► R7  purchase has no profile to appear on ✗
            ├──► R8  no activity history to recommend from✗
            ├──► R9  nothing to "unlink"                  ✗
            └──► R10 no anchor for a plug-in to attach to ✗
```

**The fix, in one sentence:** Customer 360 must own a small local table of *people*, with a stable
`CustomerId`, and a second table mapping identifiers (email, phone, NRIC, CIF) to that person. The CRM
stays the source of truth for **profile fields**; OmniConnect owns the **identity**.

This is exactly what commercial Customer Data Platforms do — they call it *identity resolution* and the
result a *golden record* ([CDP.com — Identity Resolution][s6], [Hightouch][s8]).

---

## 4. Target architecture

### 4.1 Services

| Service | New? | Owns (its own database) | Purpose |
|---|---|---|---|
| AuthService | exists | users, roles, permissions, approvals | Identity of **staff**, not customers |
| ModuleRegistry | exists | remote apps, capabilities | Which apps exist and are healthy |
| LeadService | exists | leads (`L001`) | Lead management |
| **Customer360Service** | exists, **grows** | **customers, identifiers, related_records, panels** | The hub. Owns customer identity |
| **NotificationService** | 🆕 | templates, messages, delivery receipts | R1 — send email/SMS/in-app |
| **AuditLogService** | 🆕 | audit events (append-only) | R2 — one audit store for everything |
| **CaseService** | 🆕 | cases (`C001`) | R4 — case management |
| **MarketplaceService** | 🆕 | products, orders (`O001`) | R7 — product marketplace |
| **RecommendationService** | 🆕 | activity counters, suggestions | R8 — "interested" products |

### 4.2 Target shape

```
                        ┌─────────────────────────────┐
        Browser ───────►│  Host app (React)           │
                        └──────────┬──────────────────┘
                                   │ Module Federation
        ┌──────────┬───────────────┼───────────┬──────────────┐
        ▼          ▼               ▼           ▼              ▼
    lead_mf    case_mf       customer360_mf  market_mf     (future app)
        │          │               │           │              │
════════╪══════════╪═══════════════╪═══════════╪══════════════╪═════ HTTP (reads)
        ▼          ▼               ▼           ▼              ▼
  ┌──────────┐┌─────────┐  ┌──────────────┐┌───────────┐┌──────────┐
  │LeadService││CaseSvc  │  │Customer360Svc││Marketplace││  Future  │
  │  L001    ││  C001   │  │   THE HUB    ││   O001    ││   X001   │
  └────┬─────┘└────┬────┘  └──────┬───────┘└─────┬─────┘└────┬─────┘
       │           │              ▲              │           │
       │ outbox    │ outbox       │ consumes     │ outbox    │ outbox
       ▼           ▼              │              ▼           ▼
  ╔════════════════════════════════════════════════════════════════╗
  ║                    RabbitMQ  (event backbone)                  ║
  ║   exchange: omniconnect.events   (topic)                       ║
  ╚═══╤═══════════╤═══════════════════╤══════════════╤═════════════╝
      │           │                   │              │
      ▼           ▼                   ▼              ▼
 ┌─────────┐ ┌──────────┐    ┌────────────────┐ ┌──────────────┐
 │AuditLog │ │Notificat.│    │Recommendation  │ │  (any new    │
 │ Service │ │ Service  │    │   Service      │ │  consumer)   │
 └────┬────┘ └────┬─────┘    └───────┬────────┘ └──────────────┘
      ▼           ▼                  ▼
  auditDB     notifyDB           recoDB

  Each service still has its OWN database. They never share tables.
  They share EVENTS.
```

### 4.3 The two rules that make this work

**Rule 1 — A service never reads another service's database.** Ever. It either calls its API, or it
listens to its events. This is what keeps the databases independent ([microservices.io][s1]).

**Rule 2 — Customer 360 never calls the other apps to build a profile.** Instead, the apps *push* a
small summary to Customer 360 when something changes. This is the CQRS "materialized view" idea: keep a
local read-only copy so the page renders from one database instead of calling five services
([microservices.io — CQRS][s3], [Medium — Querying microservices with CQRS + materialized view][s4]).

**Why not the simpler option?** You could have Customer 360 call Leads + Cases + Marketplace live and
join in memory — that is the *API Composition* pattern ([microservices.io][s2]). It is simpler, but:

| | API Composition (call live) | Materialized view (this design) |
|---|---|---|
| Profile page speed | Slow — as slow as the slowest app | Fast — one local query |
| If Case Service is down | **Profile page breaks** | Profile still shows cases (from local copy) |
| Adding a 6th app | Customer 360 must add a new call | **Zero change** — the app just publishes |
| Data freshness | Always current | A few seconds behind |

The "few seconds behind" is the price. For a profile screen, that is the right trade.

---

## 5. The Customer 360 Plug-In Contract

**This section is the answer to R10** — *"some standard so that in future any remote app we want to link
with it, we do less or no change in customer 360."*

### 5.1 The idea in one picture

Today, adding an app means editing Customer 360. In the target, an app **declares** itself and
**publishes** events. Customer 360 is written once and never touched again.

```
   BEFORE (today)                      AFTER (this design)
   ─────────────                       ───────────────────
   New app? →  edit Customer360.tsx    New app? →  it publishes a manifest
               edit backend                        + publishes events
               edit DTOs                           ↓
               redeploy C360           Customer 360 changes: NONE
```

### 5.2 The three parts of the contract

An app that wants to appear on a customer profile must do exactly three things.

#### Part 1 — Declare a panel in its manifest

You already have a manifest mechanism: every remote publishes `GET /permissions`, and
`RemoteAppAppService.CreateAsync` fetches it on registration. **Extend that same endpoint** rather than
inventing a new one — add a `customerPanels` array:

```json
{
  "modules": [ ... existing ... ],
  "capabilities": [ ... existing ... ],

  "customerPanels": [
    {
      "key": "cases",
      "title": "Cases",
      "icon": "Briefcase",
      "sortOrder": 30,
      "requiredCapability": "remote.case.case:View",
      "recordType": "case",
      "columns": [
        { "field": "reference",  "label": "Case ID",  "type": "text",  "primary": true },
        { "field": "subject",    "label": "Subject",  "type": "text"  },
        { "field": "status",     "label": "Status",   "type": "badge" },
        { "field": "createdAt",  "label": "Opened",   "type": "date"  }
      ],
      "detailUrlTemplate": "/apps/case/view/{recordId}"
    }
  ]
}
```

Customer 360 stores this and renders it generically. It has **no idea what a "case" is** — it just
renders columns from data.

> **Reuse note:** this is the same "config as data" idea you already proved works in
> [`docs/JSONB-USER-SCHEMA.md`](JSONB-USER-SCHEMA.md) — the admin-configurable user form. Store the
> panel definitions in a `jsonb` column exactly the same way.

#### Part 2 — Publish an event when a record changes

Use the **CloudEvents** standard envelope — a CNCF *graduated* project, so it is a genuine industry
standard rather than a convention you invented ([CloudEvents spec][s9]):

```json
{
  "specversion": "1.0",
  "type":        "com.omniconnect.case.upserted.v1",
  "source":      "/services/case",
  "id":          "b7e1...unique...",
  "time":        "2026-09-10T09:15:00Z",
  "subject":     "C001",
  "datacontenttype": "application/json",

  "data": {
    "recordId":   "9f2c-...-guid",
    "reference":  "C001",
    "recordType": "case",
    "identifiers": { "email": "jane@gmail.com", "phone": "+60123456789" },
    "summary": {
      "subject":   "Card not working",
      "status":    "Open",
      "createdAt": "2026-09-10T09:15:00Z"
    },
    "deepLink": "/apps/case/view/9f2c-...-guid"
  }
}
```

Two fields carry the whole contract:
- **`identifiers`** — how Customer 360 finds the person (§6).
- **`summary`** — the columns the panel declared. Nothing more. Customer 360 stores a *summary*, never
  the full record; the full record stays in the owning service.

**Versioning:** the `v1` in the `type` is deliberate. CloudEvents explicitly recommends putting a
version in `type` so you can publish `v2` alongside `v1` and let consumers migrate at their own pace
([CloudEvents primer — versioning][s10]).

#### Part 3 — Expose one endpoint for detail-on-demand

`GET /internal/records/{recordId}` — used only when someone clicks a row. Keeps the summary small.

### 5.3 What Customer 360 stores

Two new tables. Note there is **nothing case-specific or product-specific** in them:

```sql
-- A panel definition, learned from an app's manifest. No code change to add one.
CREATE TABLE customer_panels (
    panel_key           text PRIMARY KEY,        -- 'cases'
    app_key             text NOT NULL,           -- 'case'
    title               text NOT NULL,
    icon                text,
    sort_order          int  NOT NULL DEFAULT 100,
    required_capability text,
    definition          jsonb NOT NULL,          -- columns[], detailUrlTemplate
    is_enabled          boolean NOT NULL DEFAULT true,
    updated_at          timestamptz NOT NULL
);

-- One row per record from any app. THIS is the generic join point.
CREATE TABLE related_records (
    id            uuid PRIMARY KEY,
    customer_id   uuid NOT NULL REFERENCES customers(id),
    app_key       text NOT NULL,                 -- 'case'   | 'lead'   | 'marketplace'
    record_type   text NOT NULL,                 -- 'case'   | 'lead'   | 'order'
    record_id     text NOT NULL,                 -- owning service's PK
    reference     text,                          -- 'C001'   | 'L001'   | 'O001'
    summary       jsonb NOT NULL,                -- whatever the panel's columns need
    deep_link     text,
    link_state    text NOT NULL DEFAULT 'active',-- 'active' | 'unlinked'   ← §8
    occurred_at   timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL,
    UNIQUE (app_key, record_type, record_id)     -- makes re-delivery safe (idempotent)
);

CREATE INDEX ix_related_customer_state
    ON related_records (customer_id, link_state, occurred_at DESC);
```

That `UNIQUE (app_key, record_type, record_id)` is important: RabbitMQ guarantees *at-least-once*
delivery, so the same event **will** sometimes arrive twice. An upsert on this key makes duplicates
harmless ([AWS — Transactional outbox][s5]).

### 5.4 Worked example: adding Case Management, start to finish

```
 STEP 1  Register the app (existing flow — RemoteAppAppService.CreateAsync)
         POST /api/remote-apps  { key: "case", manifestUrl: "..." }
              │
              ├─► probes mf-manifest.json          (already implemented today)
              ├─► fetches GET /permissions         (already implemented today)
              └─► NEW: reads customerPanels[] ──► POST to Customer360
                                                   → INSERT INTO customer_panels

 STEP 2  A user creates a case in the Case app for jane@gmail.com
         CaseService: INSERT INTO cases (...)   reference = 'C001'
                      INSERT INTO outbox  (...) ← SAME transaction (§7)

 STEP 3  Outbox poller publishes to RabbitMQ
         routing key: case.upserted

 STEP 4  Customer360 consumes it
         a) resolve identifiers.email → customer_id      (§6)
         b) UPSERT INTO related_records (...)

 STEP 5  User opens Jane's profile
         SELECT * FROM customer_panels WHERE is_enabled
         SELECT * FROM related_records WHERE customer_id = ? AND link_state='active'
         → the "Cases" panel renders, showing C001

 CODE CHANGED INSIDE CUSTOMER 360:  ███ NONE ███
```

### 5.5 The unified profile screen (R6)

Because `related_records` is generic, `L001` and `C001` sit in the *same table* and render side by side
with no special casing:

```
┌────────────────────────────────────────────────────────────────┐
│  👤  Jane Tan                              CUS-000001          │
│      jane@gmail.com  ·  +60 12-345 6789                        │
│      Sources:  [Lead]  [Case]         CRM: ✓ linked (CIF 8842) │
├────────────────────────────────────────────────────────────────┤
│  Profile │ Leads │ Cases │ Products │ Interested │ Activity    │
│          └───────┴───────┴──────────┴────────────┘             │
│           ▲ every one of these tabs is generated from          │
│             customer_panels — none are hardcoded               │
├────────────────────────────────────────────────────────────────┤
│  LEADS                                                         │
│  ┌───────┬─────────────────┬──────────┬────────────┐           │
│  │ L001  │ Home Financing  │ Open     │ 12 Aug 26  │           │
│  └───────┴─────────────────┴──────────┴────────────┘           │
│  CASES                                                         │
│  ┌───────┬─────────────────┬──────────┬────────────┐           │
│  │ C001  │ Card not working│ Open     │ 10 Sep 26  │           │
│  └───────┴─────────────────┴──────────┴────────────┘           │
└────────────────────────────────────────────────────────────────┘
```

> **Frontend consequence:** `Customer360.tsx` (2361 lines of hardcoded tabs) gets replaced by a loop
> over `customer_panels` and a small set of column renderers (`text`, `badge`, `date`, `currency`).
> This is the single biggest frontend change in the plan, and it is what buys you R10 permanently.

---

## 6. Identity: one person, many sources

**This section answers R3/R5/R6** — *"customer create from lead get L001, from case get C001, with same
gmail we identify same user, so their data on UI should be shown in one place."*

### 6.1 The key insight: records are not people

This is the most important idea in the document.

| | Record ID | Customer ID |
|---|---|---|
| Example | `L001`, `C001`, `O001` | `CUS-000001` |
| Identifies | one **thing that happened** | one **person** |
| Owned by | the app that created it (Lead/Case/Marketplace) | Customer 360 |
| How many per person | many | exactly one |
| Changes when merged? | never | can absorb another customer |

```
                        ┌──────────────────────┐
                        │  CUS-000001          │   ← the PERSON
                        │  Jane Tan            │
                        │  jane@gmail.com      │
                        └──────────┬───────────┘
                                   │  one person, many records
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        ┌───────────┐        ┌───────────┐        ┌───────────┐
        │   L001    │        │   C001    │        │   O001    │
        │ Lead Svc  │        │ Case Svc  │        │ Marketplace│
        └───────────┘        └───────────┘        └───────────┘
```

If you instead tried to make `L001` *be* the customer, then when the same person opens a case you would
have two "customers" and no way to say they are one. **That is the mistake this design avoids.**

### 6.2 The tables

```sql
-- The PERSON (the "golden record")
CREATE TABLE customers (
    id             uuid PRIMARY KEY,
    display_ref    text UNIQUE NOT NULL,     -- 'CUS-000001'  (display only)
    full_name      text,
    primary_email  text,
    primary_phone  text,
    crm_cif        text,                     -- filled in IF/WHEN matched to the CRM (nullable!)
    status         text NOT NULL DEFAULT 'active',   -- 'active' | 'merged'
    merged_into    uuid REFERENCES customers(id),    -- set when this record was merged away
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL
);

-- Every way we know how to recognise this person
CREATE TABLE customer_identifiers (
    id              uuid PRIMARY KEY,
    customer_id     uuid NOT NULL REFERENCES customers(id),
    id_type         text NOT NULL,           -- 'email' | 'phone' | 'nric' | 'crm_cif'
    id_value_norm   text NOT NULL,           -- NORMALISED (see 6.3)
    id_value_raw    text NOT NULL,           -- exactly as entered, for display
    is_verified     boolean NOT NULL DEFAULT false,
    source_app      text NOT NULL,           -- who told us  ('lead' | 'case' | 'crm')
    created_at      timestamptz NOT NULL,

    -- THIS is what makes matching work and prevents duplicates
    UNIQUE (id_type, id_value_norm)
);

-- Which source record created/touched this person (audit trail of identity)
CREATE TABLE customer_source_records (
    customer_id  uuid NOT NULL REFERENCES customers(id),
    app_key      text NOT NULL,              -- 'lead'
    record_id    text NOT NULL,              -- the lead's guid
    reference    text,                       -- 'L001'
    first_seen   timestamptz NOT NULL,
    PRIMARY KEY (app_key, record_id)
);
```

### 6.3 Normalising the email (do not skip this)

Matching on the raw email **will fail** in practice. Real examples:

| Entered in Leads | Entered in Cases | Same person? | Raw match? |
|---|---|---|---|
| `jane@gmail.com` | `Jane@Gmail.com` | yes | ❌ no |
| `jane@gmail.com` | ` jane@gmail.com ` | yes | ❌ no |
| `jane@gmail.com` | `jane+shop@gmail.com` | yes | ❌ no |
| `jane@gmail.com` | `j.a.n.e@gmail.com` | yes (Gmail ignores dots) | ❌ no |

So normalise before storing and before matching:

```
normalise_email(x):
    1. trim whitespace
    2. lowercase
    3. split into local@domain
    4. if domain is gmail.com or googlemail.com:
           remove all '.' from local
           domain := 'gmail.com'
    5. cut local at the first '+'
    6. return local + '@' + domain
```

All four rows above normalise to `jane@gmail.com` and match. Store the **raw** value too, so the UI
still shows what the person actually typed.

> ⚠️ Be careful applying dot-stripping to non-Gmail domains — most providers treat dots as significant.
> Only apply Gmail rules to Gmail.

This is **deterministic matching**: two records match only if a specific field is exactly equal after
normalisation. It is precise and every match can be explained by a rule — which matters when someone
asks "why are these two merged?" ([CDP.com — Identity Resolution][s6]). The alternative, *probabilistic*
matching (name + address similarity scoring), is what CDPs use for harder cases — **do not start there.**

### 6.4 The resolve algorithm

Every event that carries `identifiers` runs through this:

```
resolve(identifiers, sourceApp, recordId, reference):

  1. normalise every identifier

  2. look for existing matches:
        SELECT customer_id FROM customer_identifiers
        WHERE (id_type, id_value_norm) IN (the normalised set)

  3. CASE A — exactly one customer matched
        → use it.  Add any NEW identifiers we just learned.

     CASE B — no customer matched
        → CREATE a new customer  (this is R5: leads/cases can create people)
        → mint display_ref 'CUS-000042'
        → insert its identifiers

     CASE C — TWO OR MORE customers matched
        → we just learned they are the same person
        → MERGE (see 6.6). Do not silently pick one.

  4. record it:
        INSERT INTO customer_source_records (customer_id, sourceApp, recordId, reference)
        ON CONFLICT DO NOTHING
```

### 6.5 Worked example — exactly your scenario

```
 ── Day 1 ──────────────────────────────────────────────────────────
 Sales creates a lead for  "jane@gmail.com"

   LeadService   : INSERT cases…  reference = L001
                   publish  com.omniconnect.lead.upserted.v1
                            identifiers: { email: "jane@gmail.com" }

   Customer360   : normalise → jane@gmail.com
                   lookup    → no match           (CASE B)
                   CREATE customer  CUS-000001
                   identifiers: email=jane@gmail.com
                   related_records += (lead, L001)

   Profile now:   CUS-000001  ·  Leads: [L001]


 ── Day 30 ─────────────────────────────────────────────────────────
 Support creates a case for "Jane@Gmail.com"   ← different capitalisation!

   CaseService   : INSERT cases…  reference = C001
                   publish  com.omniconnect.case.upserted.v1
                            identifiers: { email: "Jane@Gmail.com" }

   Customer360   : normalise → jane@gmail.com    ← same!
                   lookup    → CUS-000001         (CASE A)
                   NO new customer created
                   related_records += (case, C001)

   Profile now:   CUS-000001  ·  Leads: [L001]   Cases: [C001]
                  ▲ ONE PERSON, ONE PAGE, BOTH RECORDS   ✅ R6
```

### 6.6 The three hard cases (plan for these now)

**(a) The race — two apps create the same new person at the same instant.**
Both check "does jane@gmail.com exist?", both see no, both try to create. Without protection you get two
customers for one person.
**Fix:** the `UNIQUE (id_type, id_value_norm)` constraint plus an upsert. One insert wins; the other
gets a conflict, re-reads, and links to the winner. Let the *database* arbitrate — never your code.

```sql
INSERT INTO customer_identifiers (id_type, id_value_norm, customer_id, ...)
VALUES ('email', 'jane@gmail.com', :newCustomerId, ...)
ON CONFLICT (id_type, id_value_norm)
DO UPDATE SET id_value_norm = EXCLUDED.id_value_norm   -- no-op, just to return the row
RETURNING customer_id;      -- ← this is the winning customer, whoever created it
```

**(b) Disagreeing data — survivorship.**
Lead says name "Jane Smith"; Case says "Jane S."; CRM says "TAN, JANE". Which one shows on the profile?

Pick an explicit rule and write it down. Recommended priority:

```
   1. CRM              (highest — it is the system of record where present)
   2. Verified value   (email/phone the person themselves confirmed)
   3. Most recent write
   4. Longest / most complete value  (tie-break: "Jane Smith" beats "Jane S.")
```

Critically: **the source records are never overwritten.** `L001` keeps saying "Jane Smith" forever. Only
the golden record picks a winner for display. This is standard master-data practice
([Master Data Management & Golden Records][s7]).

**(c) A wrong merge — and un-merging.**
Family members share an email. Someone typos an address. Deterministic email matching **will**
eventually merge two real people. Design for it from day one:
- Never physically delete on merge. Set `status='merged'` and `merged_into = <winner>` on the loser.
- Keep `customer_source_records` intact so you know exactly which records came from where.
- Un-merge = create a fresh customer and move the identified source records back.

If you hard-delete on merge, un-merging becomes impossible and you will lose data.

### 6.7 The person who is not in the CRM

Because leads and cases can create people (R5), you will have customers with `crm_cif = NULL`. The
profile page must handle this gracefully:

```
   customer.crm_cif IS NULL
        → show local data (name, email, leads, cases)
        → CRM panels (Products, Interactions) show:
             "Not yet a CRM customer"      ← not an error, not a spinner
   customer.crm_cif IS NOT NULL, CRM unreachable
        → show local data
        → CRM panels show:  "Temporarily unavailable"  + retry
```

You already learned this lesson the hard way with the CRM `ETL_STATUS` outage. The profile page must
never be *blocked* by the CRM being down.

---

## 7. Event backbone (RabbitMQ + Outbox)

**This answers your question** *"how we communicate with each other db when there are many connections
between DBs."* The answer: **they never talk to each other. They exchange events.**

### 7.1 The dual-write problem (why you cannot just publish)

The naive version is broken:

```
   ✗ WRONG
   CaseService:
       INSERT INTO cases ...          ← succeeds
       publish to RabbitMQ            ← service crashes HERE
   Result: case exists, nobody was told. Profile never shows C001. Silent data loss.
```

Or the reverse — publish succeeds, DB insert rolls back, and Customer 360 shows a case that does not
exist. You cannot wrap a database and a message broker in one transaction without distributed
transactions (2PC), which are slow and fragile ([AWS — Transactional outbox][s5]).

### 7.2 The fix: the Outbox pattern

Write the event **into your own database**, in the **same transaction** as the business data. A separate
poller publishes it afterwards.

```sql
CREATE TABLE outbox (
    id             uuid PRIMARY KEY,
    event_type     text NOT NULL,        -- 'com.omniconnect.case.upserted.v1'
    routing_key    text NOT NULL,        -- 'case.upserted'
    payload        jsonb NOT NULL,       -- the full CloudEvent
    created_at     timestamptz NOT NULL,
    published_at   timestamptz,          -- NULL = not yet sent
    attempts       int NOT NULL DEFAULT 0,
    last_error     text
);
CREATE INDEX ix_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
```

```
   ✓ RIGHT
   BEGIN;
     INSERT INTO cases  (...);
     INSERT INTO outbox (...);
   COMMIT;                  ← both or neither. Atomic. No dual write.

   [background poller, every 1s]
     SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 100
     → publish to RabbitMQ
     → UPDATE outbox SET published_at = now()
```

If the poller crashes mid-way, the event is still in the table and gets published next time. If it
publishes twice, the consumer's `UNIQUE` constraint (§5.3) makes it harmless. This gives
**at-least-once** delivery, and the standard advice is exactly that: make consumers idempotent rather
than chasing exactly-once ([AWS][s5], [Decodable — Revisiting the Outbox Pattern][s11]).

### 7.3 RabbitMQ topology

```
                 ┌─────────────────────────────────────────┐
   publishers ──►│  exchange: omniconnect.events  (topic)  │
                 └───┬─────────────┬──────────────┬────────┘
       routing key   │             │              │
       lead.upserted │             │              │
       case.upserted │             │              │
       order.placed  │             │              │
                     ▼             ▼              ▼
            ┌─────────────┐ ┌────────────┐ ┌──────────────┐
            │ q.customer  │ │ q.audit    │ │ q.reco       │
            │   360       │ │            │ │              │
            │ binds: *.up-│ │ binds: #   │ │ binds:       │
            │ serted,     │ │ (everything)│ │ *.upserted,  │
            │ order.*     │ │            │ │ activity.*   │
            └──────┬──────┘ └─────┬──────┘ └──────┬───────┘
                   │              │               │
            (on repeated failure) │               │
                   ▼              ▼               ▼
            ┌────────────────────────────────────────────┐
            │  dlx.omniconnect  →  q.dead-letter         │
            │  (inspect + replay by hand)                │
            └────────────────────────────────────────────┘
```

Key points:
- **One exchange, many queues.** Adding a consumer = binding a new queue. **No publisher changes.**
  This is what makes the plug-in contract work.
- **Each consumer has its own queue.** Audit being slow does not slow Customer 360.
- **Dead-letter queue** for messages that keep failing, so a poison message never blocks the queue
  ([SuprSend — Notification microservice architecture][s12]).

### 7.4 Consumer idempotency

Every consumer must survive the same event arriving twice:

```sql
CREATE TABLE processed_events (
    event_id     text PRIMARY KEY,      -- CloudEvents 'id'
    processed_at timestamptz NOT NULL
);
```

```
   on message:
      INSERT INTO processed_events (event_id) VALUES (:id)
      ON CONFLICT DO NOTHING;
      if 0 rows inserted → already handled, ACK and stop.
      else → do the work
```

---

## 8. Unsubscribe without losing data

**This answers R9** — *"if that user unsubscribe our case management and we disable case management from
him, the cases should be dislinked from the profile but not the previous data."*

### 8.1 The rule

> **Unlink is a visibility change, not a deletion.**

Never `DELETE FROM related_records`. Flip `link_state` from `'active'` to `'unlinked'`. The rows stay
exactly where they are.

### 8.2 State machine

```
                    subscribe / re-subscribe
              ┌──────────────────────────────────┐
              │                                  │
              ▼                                  │
     ┌────────────────┐   unsubscribe    ┌───────┴────────┐
     │    active      │─────────────────►│   unlinked     │
     │                │                  │                │
     │ • shows on UI  │                  │ • hidden on UI │
     │ • in search    │                  │ • not in search│
     │ • rows exist   │                  │ • ROWS STILL   │
     │                │                  │   EXIST ✓      │
     └────────────────┘                  └───────┬────────┘
                                                 │
                                   retention period expires
                                   (a deliberate, separate,
                                    policy-driven job)
                                                 ▼
                                        ┌────────────────┐
                                        │    purged      │
                                        │ (only if legal │
                                        │  policy says)  │
                                        └────────────────┘
```

### 8.3 What actually happens

```
   Admin disables Case Management for Jane
        │
        ├─► AuthService: revoke capability   (already works today)
        │
        └─► publish  com.omniconnect.subscription.revoked.v1
                     { customerId, appKey: "case" }
                          │
                          ▼
            Customer360 consumer:
                UPDATE related_records
                   SET link_state = 'unlinked', updated_at = now()
                 WHERE customer_id = :id AND app_key = 'case';

   Profile page query is unchanged:
                WHERE customer_id = ? AND link_state = 'active'
        → the Cases panel simply has no rows → panel hides itself
        → CaseService's own database is UNTOUCHED. C001 still exists there.
```

Re-subscribing flips it back to `'active'` and **everything reappears**, because nothing was ever
deleted.

### 8.4 Why this is also the compliant answer

This mirrors what data-protection guidance recommends: separate *"stop using it operationally"* from
*"destroy it"*. Keep the minimum necessary in a restricted state with a defined retention period and a
legal basis, rather than deleting immediately ([Docbyte — GDPR delete/retain/archive][s13]). Real
systems deliberately delay destruction so support can undo an accidental unsubscribe
([GOV.UK — data cleanup mechanisms][s14]).

Two extra safeguards worth building:
- **A soft-delete grace period** before any true purge (30 days is a common choice).
- **A tombstone audit row** recording who unlinked what and when — which the new Audit Service (R2)
  gives you for free.

---

## 9. Recommendations — the "Interested" section

**This answers R8.** Remember from §2.3 that today's "Interested Products" is three columns rendering one
hardcoded row — this is a real build.

### 9.1 Start with rules, not machine learning

Strong recommendation: **do not start with ML.** You do not yet have the event history to train
anything, and a rules engine gets you 80% of the value immediately. The industry path is
ingest events → aggregate features → serve ([Conduktor — recommendations with streaming data][s15]).

```
   Phase A (start here)          Phase B (later)           Phase C (much later)
   ────────────────────          ───────────────           ──────────────────
   Rules:                        Item-to-item:             Collaborative filtering
   • has home loan               "people who bought X      / ML model with a
     → suggest home insurance     also bought Y"           feature store
   • viewed gold 3+ times        (computed nightly from
     → suggest gold plan          your own order data)
   • age 25-35 + no card
     → suggest credit card
```

### 9.2 How the data flows

```
   Every app publishes activity events (already partly exists —
   the host bridge has trackActivity({page, module, action}))
                  │
                  ▼
       ╔═══════════════════════╗
       ║      RabbitMQ         ║
       ╚═══════════┬═══════════╝
                   ▼
        ┌──────────────────────┐
        │ RecommendationService│
        │                      │
        │  customer_activity   │  ← rolling counters, not raw logs
        │  ┌────────────────┐  │
        │  │customer_id     │  │
        │  │category        │  │  'gold', 'home-loan'
        │  │views_30d       │  │
        │  │last_seen       │  │
        │  └────────────────┘  │
        │           │          │
        │           ▼          │
        │     rules engine     │
        │           │          │
        │           ▼          │
        │  customer_suggestions│
        └──────────┬───────────┘
                   │ publishes  recommendation.updated
                   ▼
            Customer360 → related_records (record_type='suggestion')
                        → renders in the "Interested" panel
```

The neat part: **recommendations use the exact same plug-in contract as cases and orders.** The
"Interested" panel is just another `customer_panels` row. No special code.

### 9.3 Keep counters, not raw history

Do not store every click forever. Keep rolling aggregates ("views in last 30 days") — this is the
standard "maintain running aggregations such as items viewed in the last hour" approach
([Conduktor][s15]), and it keeps the table small and fast.

---

## 10. Human-readable IDs (L001, C001…)

**This answers R3.**

### 10.1 What is wrong with what you have now

`LeadService.cs:128` currently generates:

```csharp
$"LEAD-{DateTime.UtcNow:yyyyMMddHHmmss}-{Random.Shared.Next(1000,9999)}"
```

Three problems:
1. **It can collide.** Two leads in the same second have a 1-in-9000 chance of the same random number.
   Across thousands of leads that *will* happen.
2. **There is no `UNIQUE` constraint** on the column, so a collision is stored silently and you find out
   much later.
3. **It is not what you asked for** — you want `L001`.

### 10.2 Why `MAX(id) + 1` is also wrong

The obvious fix is worse:

```
   Instance A                    Instance B
   SELECT MAX(num) → 7           SELECT MAX(num) → 7      ← both read 7
   INSERT 8                      INSERT 8                 ← DUPLICATE
```

Under load with multiple service instances this breaks constantly. Never compute IDs by reading the
table.

### 10.3 The recommended approach: a Postgres sequence per record type

A sequence is atomic — the database guarantees two callers never receive the same value, even across
different servers ([CalliCoder — distributed unique ID generation][s16]).

```sql
CREATE SEQUENCE lead_ref_seq START 1;

-- in the service's own database (LeadService owns this, nobody else touches it)
INSERT INTO leads (id, lead_reference, ...)
VALUES (
    gen_random_uuid(),
    'L' || LPAD(nextval('lead_ref_seq')::text, 3, '0'),   -- L001, L002, ... L999, L1000
    ...
);

ALTER TABLE leads ADD CONSTRAINT uq_lead_reference UNIQUE (lead_reference);  -- ← non-negotiable
```

### 10.4 The prefix registry (so two apps never collide)

Write this table down and keep it in the repo. Every new app gets a prefix **before** it is built:

| Prefix | Meaning | Owned by | Example |
|---|---|---|---|
| `CUS` | Customer (person) | Customer360Service | `CUS-000001` |
| `L` | Lead | LeadService | `L001` |
| `C` | Case | CaseService | `C001` |
| `O` | Order / purchase | MarketplaceService | `O001` |
| `N` | Notification | NotificationService | `N001` |
| *(reserved)* | — | — | Add here before coding |

### 10.5 Honest trade-offs you must accept

**Sequences leave gaps.** If a transaction rolls back, that number is burned — you might go
`L001, L002, L004`. This is normal and correct. **Do not try to eliminate gaps**: the only way is to
lock the table on every insert, which destroys concurrency. Gap-free numbering and high throughput are
mutually exclusive. If an auditor requires gap-free sequences, that is a separate, deliberately slow,
single-threaded process — not your main insert path.

**What happens after `L999`?** `LPAD(..., 3, '0')` does not truncate — it simply stops padding, so you
get `L1000`. Nothing breaks. If you want fixed width forever, pad to 6: `L000001`.

**Per-year reset?** If you want `L-2026-001`, use a separate sequence per year and a scheduled job to
create next year's. Slightly more moving parts; only do it if the business asks.

**Keep the Guid.** The primary key should stay `uuid`. `L001` is a *display reference* in its own
column. Guids are safe to expose in URLs and safe to generate offline; sequential numbers leak business
volume (a competitor seeing `L847` knows you have ~847 leads).

---

## 11. Database strategy

**This answers** *"is current one good to go or not, how we communicate between DBs, how we handle if one
DB fails, how we separate each DB and remove the single point of failure."*

### 11.1 Verdict on your current schema

| Aspect | Verdict | Why |
|---|---|---|
| Database-per-service | ✅ **Keep it** | Already correct. Four separate Neon databases |
| No cross-DB foreign keys | ✅ **Keep it** | Correct — FKs across services would weld them together |
| Loose reference columns | ⚠️ **Tighten types** | `AuditLog.UserId` as `string = "USR-1001"` should be `Guid?` |
| Customer 360 stores nothing | ❌ **Must change** | §3 — this blocks 7 of your 12 requirements |
| Audit built 3 times | ❌ **Consolidate** | R2 |
| No outbox tables | ❌ **Add** | §7 — required for reliable events |
| No unique constraint on lead ref | ❌ **Add** | §10 |
| Secrets in `appsettings.json` | 🔴 **Fix now** | Unrelated to scale; it is a live security hole |

**Short answer: your schema is structurally good. Your problem is missing tables, not wrong ones.**

### 11.2 Should you merge into one database? No.

It is tempting — one database, real foreign keys, easy joins. Do not do it.

| | One shared DB | Database-per-service (yours) |
|---|---|---|
| Joins across features | Easy | Need events / API calls |
| One service's bad query | **Slows down everything** | Contained to that service |
| Schema change | Must coordinate all teams | Independent |
| Scale one hot feature | Scale the whole DB | Scale just that DB |
| One DB dies | **Whole platform down** | One feature degrades |
| Zero-downtime deploys | Very hard | Achievable |

That last-but-one row is precisely the "single point of failure" you asked to remove. Merging databases
would *create* the SPOF you are trying to eliminate.

### 11.3 How the databases "communicate" (they don't — services do)

```
   ✗ NEVER                              ✓ ALWAYS
   ┌────────┐   direct SQL   ┌────────┐   ┌────────┐  event   ┌────────┐
   │ caseDB │◄──────────────►│ c360DB │   │CaseSvc │─────────►│C360 Svc│
   └────────┘                └────────┘   └───┬────┘          └───┬────┘
                                              ▼                   ▼
                                          ┌────────┐          ┌────────┐
                                          │ caseDB │          │ c360DB │
                                          └────────┘          └────────┘
```

Two legitimate mechanisms, and when to use each:

| Need | Use | Example |
|---|---|---|
| Show a summary on a page | **Events → local copy** (CQRS view) | Cases on the profile |
| Need the full record right now | **Direct API call** | Clicking a case to see details |
| Need it to be transactionally correct | **Keep it in one service** | Don't split it in the first place |

### 11.4 What happens when one database fails

This is the important table. Design each of these deliberately:

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  BLAST RADIUS  —  what still works when X is down                │
   ├────────────────┬─────────────────────────────────────────────────┤
   │ caseDB down    │ ✅ login, leads, profile, products              │
   │                │ ⚠️  Cases panel shows "temporarily unavailable" │
   │                │     (data is in c360DB's local copy — still     │
   │                │      READABLE, just can't create new cases)     │
   ├────────────────┼─────────────────────────────────────────────────┤
   │ c360DB down    │ ✅ login, create leads, create cases            │
   │                │ ❌ profile page                                 │
   │                │ 📥 events QUEUE UP in RabbitMQ, replay on recovery│
   ├────────────────┼─────────────────────────────────────────────────┤
   │ authDB down    │ ❌ login (unavoidable — it IS identity)         │
   │                │ ✅ already-issued JWTs keep working until expiry│
   │                │ ⚠️  TODAY: all mutations everywhere fail (P2)   │
   │                │     TARGET: mutations continue, approvals queue │
   ├────────────────┼─────────────────────────────────────────────────┤
   │ External CRM   │ ✅ everything local (leads, cases, orders)      │
   │ down           │ ⚠️  CRM panels degrade with a message           │
   │                │     (you already hit this — the ETL_STATUS      │
   │                │      outage — and it should NOT break the page) │
   └────────────────┴─────────────────────────────────────────────────┘
```

**The key property:** because Customer 360 keeps a *local copy* of case/lead/order summaries, the
profile page still renders when those services are down. That is the payoff for the CQRS design in §4.3.

### 11.5 Practical database hardening

1. **Connection pooling** — you already use Neon's `-pooler` endpoints. Good.
2. **Read replicas** for Customer 360 — profile reads are heavy and read-only. Send them to a replica.
3. **Point-in-time recovery** — confirm it is on for every Neon database, not just one.
4. **Per-service DB users** with least privilege. Today one leaked `.env` exposes everything.
5. **`EnableRetryOnFailure`** — already present (6 retries / 20s). Keep it.
6. **Health checks on every service** — three have `AddHealthChecks().AddDbContextCheck<>()`;
   **Customer360Service has a hand-rolled `HealthController` with no DB check.** Make it consistent.

---

## 12. Removing single points of failure

Every SPOF below was found in your actual code.

| # | SPOF | What breaks now | Fix | Priority |
|---|---|---|---|---|
| 1 | **Approval calls hard-fail** — `ApprovalServiceUnavailableException` | AuthService down ⇒ **no writes anywhere** | Queue approvals via outbox; allow the write, mark it `pending-approval` | 🔴 highest |
| 2 | **No circuit breakers** | A slow service hangs callers for the full 10s timeout; threads pile up | **Polly** — retry + circuit breaker + timeout + fallback ([Polly][s17]) | 🔴 |
| 3 | **JWT private key in repo** | Anyone can mint admin tokens | Rotate; move to a secret manager | 🔴 |
| 4 | **Single shared `Internal__ApiKey`** | One leak = every internal endpoint exposed; can't revoke one service | Per-service keys, or mTLS | 🟠 |
| 5 | **SignalR, no Redis backplane** (`Program.cs:378`) | Real-time breaks with 2+ instances | Add the Redis backplane | 🟠 |
| 6 | **CRM is a hard dependency** | CRM down ⇒ profile unusable | Local identity + cached summaries (§6.7) | 🟠 |
| 7 | **Single instance per service** | Any restart = downtime | 2+ instances behind a load balancer | 🟠 |
| 8 | **`FineCapabilityClient` fails closed, 30s cache** | AuthService blip ⇒ users lose permissions | Longer stale-cache fallback on *transient* failure | 🟡 |
| 9 | **No dead-letter handling** (nothing to fail yet) | Future: one bad message blocks a queue | DLQ from day one (§7.3) | 🟡 |

### 12.1 What a circuit breaker buys you

```
   WITHOUT                                WITH
   ───────                                ────
   CaseSvc ──10s timeout──► C360 (down)   CaseSvc ──► [breaker OPEN] ──► fail fast (2ms)
        every request waits 10s                 returns cached / queues event
        threads exhaust                         threads stay free
        CaseSvc ALSO goes down                  CaseSvc STAYS UP
        ↑ cascading failure                     ↑ contained
```

The circuit opens after N failures, blocks calls for a cooldown, then half-opens to test recovery
([Polly][s17], [Medium — Resilient .NET 8 microservices with Polly][s18]). Combine with:
- **Timeout** — never wait 10s; 2s is plenty internally.
- **Fallback** — cached value, empty list, or "queue it for later".
- **Bulkhead** — cap concurrent calls per dependency so one slow service can't consume every thread.

---

## 13. Zero downtime

**This answers R12.**

### 13.1 Recommendation for your deployment target

You said this is undecided. **Recommendation: containers on a managed platform — start with Azure
Container Apps / AWS ECS Fargate (PaaS), not Kubernetes.**

| Option | Zero-downtime | Ops burden | Verdict for you |
|---|---|---|---|
| VMs + nginx | Manual blue-green; you build everything | High | ✗ |
| **PaaS (Container Apps / ECS / App Service slots)** | **Built in** (rolling + slot swap) | **Low** | ✅ **Start here** |
| Kubernetes | Excellent, most control | High — needs a dedicated person | Later, if you outgrow PaaS |

With ~9 services and (I assume) a small team, Kubernetes would cost you more in operations than it
returns. PaaS gives you rolling deploys, health probes and autoscaling without a cluster to babysit.

### 13.2 The three deployment strategies

```
  ROLLING            BLUE-GREEN                CANARY
  ───────            ──────────                ──────
  v1 v1 v1           ┌──────┐  ┌──────┐        99% ──► v1
  v2 v1 v1           │ BLUE │  │GREEN │         1% ──► v2   watch errors
  v2 v2 v1           │  v1  │  │  v2  │        90/10 → 50/50 → 0/100
  v2 v2 v2           └───┬──┘  └───┬──┘
                         └──LB─────┘           slowest, safest
  cheap, gradual      instant switch,          best for risky changes
  needs 2 versions    instant rollback,
  to coexist          needs 2× resources
```

All three share **one hard requirement**: *old and new code must run at the same time against the same
database.* Which brings us to the real difficulty.

### 13.3 Expand–contract migrations (the actual hard part)

Deployment is easy. **Schema changes are what break zero downtime.** The rule:

> **Never make a breaking schema change in one step.** Split it across releases so old and new code both
> work at every moment.

Worked example — renaming `lead_reference` to `reference`:

```
  ❌ NAIVE (causes downtime)
     ALTER TABLE leads RENAME COLUMN lead_reference TO reference;
     → every running v1 instance breaks instantly

  ✅ EXPAND–CONTRACT (four releases, zero downtime)

  ┌─ Release 1: EXPAND ──────────────────────────────────────┐
  │  ALTER TABLE leads ADD COLUMN reference text;            │
  │  (nullable! no default! — an instant metadata change)    │
  │  Code: still reads/writes lead_reference                 │
  │  v1 ✓   v2 ✓                                             │
  └──────────────────────────────────────────────────────────┘
  ┌─ Release 2: DUAL WRITE ──────────────────────────────────┐
  │  Code writes BOTH columns, reads lead_reference          │
  │  Backfill in batches:                                    │
  │    UPDATE leads SET reference = lead_reference           │
  │    WHERE reference IS NULL LIMIT 1000;  (repeat)         │
  │  v1 ✓   v2 ✓                                             │
  └──────────────────────────────────────────────────────────┘
  ┌─ Release 3: SWITCH READS ────────────────────────────────┐
  │  Code reads `reference`, still writes both               │
  │  Now safe to roll back — old column is still current     │
  │  v1 ✓   v2 ✓                                             │
  └──────────────────────────────────────────────────────────┘
  ┌─ Release 4: CONTRACT ────────────────────────────────────┐
  │  Stop writing lead_reference                             │
  │  ALTER TABLE leads DROP COLUMN lead_reference;           │
  │  (only after you're certain no rollback is needed)       │
  └──────────────────────────────────────────────────────────┘
```

This is the standard approach: add alongside, migrate, then remove later
([DevOpsSchool — zero-downtime DB migration][s19], [Cozcore — blue-green & canary guide][s20]).

**Postgres-specific rules that matter:**

| Operation | Safe? | Note |
|---|---|---|
| `ADD COLUMN` (nullable, no default) | ✅ instant | Metadata only |
| `ADD COLUMN ... DEFAULT` | ✅ in PG 11+ | Older versions rewrite the table |
| `CREATE INDEX` | ❌ **locks writes** | Use `CREATE INDEX CONCURRENTLY` |
| `ALTER COLUMN ... SET NOT NULL` | ❌ full scan | Add a `CHECK ... NOT VALID`, validate, then convert |
| `DROP COLUMN` | ✅ fast | But breaks old code — contract phase only |
| `RENAME COLUMN` | 🔴 **never** | Always expand-contract instead |

### 13.4 Health probes — the piece people forget

Rolling deploys only work if the platform knows when an instance is ready. Two **different** endpoints:

```
   /health/live     "am I alive?"     → if no, RESTART me
                    (no dependencies checked — a DB blip must not
                     cause a restart loop)

   /health/ready    "can I serve?"    → if no, take me OUT of the load balancer
                    (checks DB, RabbitMQ) but leave me running
```

Today you have one `/health` per service (and Customer360's is hand-rolled with no DB check). Splitting
these is small work with a large payoff.

### 13.5 Event versioning enables zero-downtime too

The same "both versions coexist" rule applies to events. Never change an event's meaning — publish a new
version:

```
   com.omniconnect.case.upserted.v1   ← keep publishing
   com.omniconnect.case.upserted.v2   ← publish alongside

   consumers migrate on their own schedule → retire v1 when nobody is bound to it
```

CloudEvents explicitly recommends carrying the version in `type` for exactly this reason
([CloudEvents primer][s10]). Adding an **optional** field is safe; removing or renaming one is not.

---

## 14. Phased roadmap

Ordered so each phase is independently shippable and nothing is blocked by unfinished work.

```
 PHASE 0 ── Security & hygiene ────────────────────── (do first, ~days)
   • Rotate JWT private key, Neon passwords, Internal__ApiKey, CRM secret
   • Remove secrets from appsettings.json / .env → secret manager
   • Add UNIQUE constraint on lead_reference
   • Split /health/live and /health/ready; fix Customer360's DB check
   ✔ Exit: no secret in git; every service reports readiness correctly

 PHASE 1 ── Event backbone ────────────────────────── (foundation)
   • Provision RabbitMQ (CloudAMQP)
   • Add `outbox` table + poller to each existing service
   • Define the CloudEvents envelope + naming convention
   • Add `processed_events` idempotency table pattern
   ✔ Exit: LeadService publishes lead.upserted; a test consumer receives it

 PHASE 2 ── Customer identity ─────────────────────── (unblocks everything)
   • customers / customer_identifiers / customer_source_records tables
   • Email/phone normalisation + resolve algorithm
   • CUS-###### sequence
   • Backfill: consume existing leads → create customers
   ✔ Exit: creating a lead creates/matches a customer; two leads with the
           same gmail resolve to ONE customer

 PHASE 3 ── Plug-in contract ──────────────────────── (the standard, R10)
   • customer_panels + related_records tables
   • Extend GET /permissions with customerPanels[]
   • ModuleRegistry pushes panels to Customer360 on registration
   • Rewrite Customer360.tsx to render panels from data (biggest FE task)
   ✔ Exit: Leads appear on the profile with ZERO Customer360 code specific
           to leads

 PHASE 4 ── Extract shared services ───────────────── (R1, R2)
   • AuditLogService — consume '#', migrate the 3 existing audit tables
   • NotificationService — queue per channel, DLQ, idempotency keys
   ✔ Exit: one audit view across all services; notifications never block

 PHASE 5 ── New business apps ─────────────────────── (R4, R5, R6, R7)
   • CaseService (C001) — publishes case.upserted
   • MarketplaceService (O001) — publishes order.placed
   • Subscription revoke/restore → link_state (R9)
   ✔ Exit: L001 and C001 for the same gmail show on ONE profile

 PHASE 6 ── Intelligence & scale ──────────────────── (R8, R11, R12)
   • RecommendationService — rules engine v1
   • Polly everywhere; fix the approval hard-fail SPOF
   • Redis backplane for SignalR; 2+ instances per service
   • Expand-contract migration discipline; canary deploys
   ✔ Exit: deploy during business hours, no user impact; one DB down
           degrades one feature only
```

**Dependency note:** Phase 2 must come before 3, 3 before 5. Phase 4 can run in parallel with 3 by a
second person. Phase 0 should start today regardless.

---

## 15. Sources

All external claims in this document link to these.

1. [Microservices.io — Database per service pattern][s1]
2. [Microservices.io — API Composition pattern][s2]
3. [Microservices.io — CQRS pattern][s3]
4. [Medium (Tributary Data) — Querying Microservices with CQRS and Materialized View][s4]
5. [AWS Prescriptive Guidance — Transactional outbox pattern][s5]
6. [CDP.com — Identity Resolution in a CDP][s6]
7. [Xylity Tech — Master Data Management & Golden Records][s7]
8. [Hightouch — What is Identity Resolution?][s8]
9. [CloudEvents — Specification v1.0 (CNCF graduated)][s9]
10. [CloudEvents — Primer (versioning guidance)][s10]
11. [Decodable — Revisiting the Outbox Pattern][s11]
12. [SuprSend — Notification Microservice Architecture (2026)][s12]
13. [Docbyte — GDPR: delete from operational systems, retain in restricted archive][s13]
14. [GOV.UK Publishing — Data cleanup mechanisms][s14]
15. [Conduktor — Building Recommendation Systems with Streaming Data][s15]
16. [CalliCoder — Generating unique IDs in a distributed environment at scale][s16]
17. [Polly — .NET resilience library (GitHub)][s17]
18. [Simform Engineering — Resilient .NET 8 microservices with Polly][s18]
19. [DevOpsSchool — Zero-downtime database migration: blue-green & canary][s19]
20. [Cozcore — Zero-downtime deployments: blue-green and canary guide][s20]

[s1]: https://microservices.io/patterns/data/database-per-service.html
[s2]: https://microservices.io/patterns/data/api-composition
[s3]: https://microservices.io/patterns/data/cqrs.html
[s4]: https://medium.com/event-driven-utopia/querying-microservices-with-the-cqrs-and-materialized-view-pattern-bdb8b17f95d1
[s5]: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
[s6]: https://cdp.com/glossary/identity-resolution/
[s7]: https://xylitytech.com/data-engineering/master-data-management-entity-resolution/
[s8]: https://hightouch.com/blog/what-is-identity-resolution
[s9]: https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
[s10]: https://github.com/cloudevents/spec/blob/main/cloudevents/primer.md
[s11]: https://www.decodable.co/blog/revisiting-the-outbox-pattern
[s12]: https://www.suprsend.com/post/notification-microservice-architecture
[s13]: https://www.docbyte.com/gdpr-delete-retain-archive/
[s14]: https://docs.publishing.service.gov.uk/repos/email-alert-api/data-cleanup-mechanisms.html
[s15]: https://www.conduktor.io/glossary/building-recommendation-systems-with-streaming-data
[s16]: https://www.callicoder.com/distributed-unique-id-sequence-number-generator/
[s17]: https://github.com/App-vNext/Polly
[s18]: https://medium.com/simform-engineering/resilient-net-8-micro-services-with-polly-retry-circuit-breaker-timeout-fallback-and-more-4bb220464be3
[s19]: https://www.devopsschool.com/blog/zero-downtime-database-migration-blue-green-canary-for-e-commerce/
[s20]: https://www.cozcore.com/blog/zero-downtime-deployments-guide

---

## Appendix A — Requirement traceability

Proof that every requirement from §1 is answered somewhere.

| Req | Section |
|---|---|
| R1 Notification Service | §4.1, §14 Phase 4 |
| R2 Audit Log Service | §4.1, §14 Phase 4 |
| R3 Human-readable IDs | §10 (all) |
| R4 Case links by email | §5.4, §6.4, §6.5 |
| R5 Multi-source creation | §6.4 Case B, §6.7 |
| R6 Same email = one profile | §6.1, §6.5, §5.5 |
| R7 Purchases on profile | §5.3, §5.4 |
| R8 Interested / recommendations | §9 |
| R9 Unlink, keep data | §8 |
| R10 Standard for future apps | §5 (all) |
| R11 Survive DB failure | §11.4, §12 |
| R12 Zero downtime | §13 |

## Appendix B — Glossary

| Term | Plain English |
|---|---|
| **Golden record** | The single "best" version of a person, assembled from many sources |
| **Identity resolution** | Working out that two records are the same person |
| **Deterministic matching** | Match only on an exact value (email). Precise, explainable |
| **Probabilistic matching** | Match on similarity scores (name+address). Powerful, riskier |
| **Outbox pattern** | Save the event in your own DB in the same transaction, publish it after |
| **Dual write** | Writing to DB and queue separately — unsafe, one can fail |
| **Idempotent** | Doing it twice has the same effect as once |
| **CQRS / materialized view** | Keep a local read-only copy so pages load from one DB |
| **CloudEvents** | An industry-standard "envelope" format for events (CNCF) |
| **DLQ** | Dead-letter queue — where messages go after repeated failure |
| **Circuit breaker** | Stop calling a failing service for a while so you don't hang |
| **Expand–contract** | Add new column → migrate → switch → drop old, across releases |
| **Blast radius** | How much breaks when one thing fails |
