# Grower Portal - Project Documentation

> **Document purpose:** Single source of truth for project context, architecture, design decisions, and operational rules. Intended audience: developers, product owners, and AI coding assistants working on this codebase.
>
> **How to maintain:** Update this file when you add a major feature, change architecture, or discover a new business rule. Keep it factual and concise. Do not duplicate what is already expressed in code (schema, route files, type definitions) — instead, reference the relevant files. Remove outdated information rather than accumulating historical notes.

---

## Overview

Multi-tenant web portal for **Coloriginz** (OZ Import BV), a Dutch flower trading company based in Aalsmeer that works on consignment with growers worldwide. Growers (kwekers) use this portal to track sales, lots, quality issues, documents, and shipment forecasts. Internal users (commercie/admin) manage growers and view aggregate insights. Transporteurs manage fust pickups and deliveries. Finance handles fust invoicing and voucher matching.

**Domain:** Cut flower trade (consignment model). Growers ship flowers to the Netherlands, Coloriginz sells at Dutch flower auctions (VBA, VPL) and via direct sales, then settles via salessheets. Fust (containers/crates) is tracked separately: growers order fust, transporteurs pick up and deliver, finance reconciles via invoices and issuance vouchers.

**Replaces:** Legacy Qlik dashboard that gave growers limited visibility into their sales performance.

---

## Goals and Scope

### Goals
1. Give consignment growers worldwide self-service visibility into sales, costs, and net yield per stem
2. Replace WhatsApp/Excel workflows for shipment forecasting with structured weekly grids
3. Digitize the full fust (container) lifecycle: ordering, pickup, delivery, invoicing, voucher reconciliation
4. Support multi-company branding (Coloriginz, OZ Import, MyPeony) from a single codebase
5. Enable internal users (commercie, finance) to manage grower relationships and fust operations efficiently

### In scope
- Grower-facing: dashboard, sales analytics, lot tracking, quality issues, documents, forecasts, fust ordering
- Internal: grower management, user management, fust operations (pickups, deliveries, invoicing, voucher matching), audit trail
- Two portals: main portal (all roles) and standalone fust portal (transporteurs)
- Email notifications in grower/transporter preferred language (EN/NL)
- Multi-company branding (logos, email from-addresses, footer text per company entity)

### Out of scope
- Data import from source systems (ERP/auction) — planned but not yet built
- Financial reporting or accounting integration (e.g., Exact Globe export is partial: XML invoice only)
- SSO / Azure AD — currently credentials-only authentication
- Mobile app — responsive web only
- Real-time data / websockets — polling via `useFetch` with manual refresh
- Languages beyond EN/NL (Spanish, Portuguese planned but not yet implemented)

### Success criteria
- Growers can independently check their sales data without contacting commercie
- Forecasts are submitted digitally instead of via WhatsApp/Excel
- Fust orders flow from request to delivery to invoice without manual coordination
- Internal users have a single dashboard instead of switching between Qlik, email, and spreadsheets

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Database | PostgreSQL via Neon (serverless) |
| ORM | Prisma 6 with `@prisma/adapter-neon` |
| Auth | NextAuth.js v5 beta (JWT strategy, Credentials provider) |
| UI | Tailwind CSS 4 + shadcn/ui (Base UI primitives) |
| Icons | Remix Icons (`@remixicon/react`) |
| Charts | Recharts 3 |
| Toasts | Sonner |
| Validation | Zod |
| i18n | Custom JSON-based system (EN/NL) |
| Email | Nodemailer (Ethereal dev, Resend prod) |
| File Storage | Vercel Blob |
| Deployment | Vercel (test + production targets) |

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root layout with Providers
│   ├── page.tsx                      # Root redirect
│   ├── globals.css                   # Tailwind CSS
│   ├── icon.svg                      # Favicon (SVG leaf)
│   ├── login/page.tsx                # Public login page
│   ├── activate/                     # Account activation flow
│   ├── (portal)/                     # Protected route group (grower/commercie/admin/finance)
│   │   ├── layout.tsx                # AppShell wrapper (auth check)
│   │   ├── dashboard/                # Dashboard (grower + aggregate)
│   │   ├── sales/                    # Sales analytics + trends
│   │   ├── lots/                     # Lot overview + detail
│   │   ├── quality/                  # Quality issues
│   │   ├── documents/                # Document management
│   │   ├── forecasts/                # Shipment forecasts (weekly grid)
│   │   ├── fust/                     # Fust pages (orders, pickups, deliveries, vouchers, invoices, activity)
│   │   ├── profile/                  # Grower profile
│   │   ├── growers/                  # Grower management (admin/commercie)
│   │   └── admin/                    # User management (admin)
│   ├── (fust-portal)/                # Standalone fust portal (transporteur login)
│   │   └── fust-portal/             # FustShell layout + pages (my-orders, pickups, deliveries, etc.)
│   └── api/                          # API routes (see below)
├── components/
│   ├── layout/                       # AppShell, GrowerSelector, TestBanner, etc.
│   ├── charts/                       # Recharts wrappers
│   ├── providers/                    # LanguageProvider, SessionProvider
│   ├── ui/                           # shadcn/ui primitives
│   ├── language-switcher.tsx
│   └── theme-switcher.tsx
├── hooks/
│   └── use-fetch.ts                  # Generic data fetching hook
├── i18n/
│   ├── index.ts                      # Translation system
│   ├── en.json                       # English translations
│   └── nl.json                       # Dutch translations
├── features/
│   └── fust/                         # Fust feature module
│       ├── components/               # Fust UI (orders, pickups, deliveries, invoices, vouchers, audit, settings)
│       ├── lib/                      # Voucher/invoice PDF parsers
│       └── navigation/               # Fust nav config
├── lib/
│   ├── auth.ts                       # NextAuth configuration
│   ├── db.ts                         # Prisma client singleton
│   ├── api-helpers.ts                # requireAuth(), resolveGrowerId()
│   ├── format.ts                     # Currency, number, date formatting (nl-NL)
│   ├── export-csv.ts                 # CSV export utility
│   ├── email.ts                      # Nodemailer setup
│   ├── email-templates.ts            # HTML email templates (activation, reset, fust approved, fust delivered)
│   ├── fust-notifications.ts        # Fust email triggers (order approved → transporter, delivery confirmed → grower)
│   ├── fust-audit.ts                # Audit trail helper: logFustEvent()
│   ├── company-config.ts            # Multi-company branding config
│   ├── company-logos.ts             # Base64 logos per company
│   ├── company-helpers.ts           # getGrowerEmailBranding()
│   ├── quality-codes.ts             # Quality code mappings
│   ├── chart-colors.ts              # Recharts color palette
│   ├── grower-context.ts            # Server-side grower context
│   ├── env.ts                        # Environment helpers
│   └── utils.ts                      # clsx/cn utility
├── types/
│   ├── index.ts                      # Domain enums (Role, LotStatus, SalesType, etc.)
│   └── next-auth.d.ts               # Session type extensions
└── generated/prisma/                 # Prisma generated client (do not edit)

prisma/
├── schema.prisma                     # Database schema
└── seed.ts                           # Test data seeder
```

---

## Authentication & Authorization

### Roles
- **grower**: Can only see own data. Linked to a single Grower record via `user.growerId`.
- **commercie**: Account manager. Can view any grower's data by passing `?growerId=` in URL. Sees aggregate dashboard when no grower selected.
- **admin**: Full access. Same multi-tenant view as commercie, plus user management.
- **transporteur**: Fust portal only. Manages pickups and deliveries. Linked to a Transporter record via `user.transporterId`.
- **finance**: Fust invoicing and voucher matching. Same nav as commercie in main portal, plus fust finance pages.

### Key Patterns
```typescript
// API route pattern: check auth, resolve grower, query data
const { error, session } = await requireAuth();        // 401 if no session
if (error) return error;
const growerId = resolveGrowerId(session!, requestedGrowerId); // growers get their own ID, others get the requested one
```

### Session Shape
```typescript
session.user = {
  id: string;
  name: string;
  email: string;
  role: "grower" | "commercie" | "admin" | "transporteur" | "finance";
  growerId: string | null;       // only set for grower users
  transporterId: string | null;  // only set for transporteur users
}
```

---

## Database Schema (Key Models)

### Core Entities
- **User** - Authentication. Has role, optional growerId/transporterId link.
- **Grower** - Supplier. Has code (e.g., "PCFUP"), company, address, certificates.
- **Company** - Multi-tenant company entity (e.g., Coloriginz, OZ Import). Growers belong to a company for branding.
- **Transporter** - Logistics partner. Manages fust pickups/deliveries.
- **Lot** - A batch of flowers delivered. Has productName, articleGroup, stemLength, totalStems, status (in_transit/selling/sold).
- **Transaction** - Individual sale from a lot. Has salesType (Direct/VBA/VPL), stems, pricePerStem, amount.
- **SalesSheet** - Invoice grouping lots. Has totalTurnover, totalCosts, netResult.
- **ShipmentForecast** - Weekly forecast per product per grower. Unique on (growerId, productName, year, week).

### Fust Entities
- **FustType** - Container type (emmers, karren, kratten, etc.) with price per unit.
- **FustOrder** - Grower orders fust. Status: pending → approved → scheduled → in_transit → delivered. Soft delete (deletedAt).
- **FustOrderItem** - Line items per order (fustType + quantity + deliveredQuantity).
- **FustPickup** - Transporter picks up fust from multiple orders. Status: planned → picked_up → completed.
- **FustDelivery** - 1:1 with FustOrder. Tracks delivery status and actual quantities.
- **FustInvoice** - Transporter invoice (PDF upload + parsed items). Status: pending → approved/rejected.
- **FustIssuanceVoucher** - Auction voucher matched to orders for reconciliation.
- **FustAuditLog** - Centralized audit trail for all fust events (19 action types). Denormalized orderId for timeline queries.

### Relationships
```
Grower → has many → Lots → has many → Transactions
Grower → has many → SalesSheets → has many → Lots
Grower → has many → ShipmentForecasts
Grower → has many → QualityIssues
Grower → has many → Documents
Grower → has many → Certificates
Grower → belongs to → User (commercie, via commercieId)
Grower → belongs to → Company (via companyId)
Grower → has many → FustOrders → has one → FustDelivery
Transporter → has many → FustPickups → has many → FustDeliveries
FustOrder → has many → FustOrderItems
FustPickup → has many → FustDeliveries
```

### Important Constraints
- `Lot.lotNumber + Lot.growerId` is unique
- `ShipmentForecast.growerId + productName + year + week` is unique
- `SalesSheet.invoiceNumber` is unique
- UUIDs as primary keys throughout

---

## API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth endpoints |
| `/api/dashboard` | GET | Dashboard data (grower or aggregate) |
| `/api/sales` | GET | Sales data with period/product/channel/length filters |
| `/api/sales/filters` | GET | Available filter options for sales |
| `/api/sales/trends` | GET | Price trends, stem length breakdown, channel distribution |
| `/api/lots` | GET | Lots with pagination and filters |
| `/api/quality` | GET | Quality issues |
| `/api/documents` | GET, POST | Document list and upload |
| `/api/documents/[id]` | GET, DELETE | Download and delete document |
| `/api/forecasts` | GET, POST, DELETE | Forecast CRUD (GET=read range, POST=upsert batch, DELETE=remove product) |
| `/api/forecasts/copy` | POST | Copy week data to subsequent weeks |
| `/api/profile` | GET, PUT | User profile |
| `/api/profile/password` | PUT | Change password |
| `/api/growers` | GET | Growers list (for selector) |
| `/api/growers/[id]` | GET, PUT | Grower detail and update |
| `/api/growers/[id]/activate` | POST | Send activation email |
| `/api/admin/users` | GET, POST | User management |
| `/api/admin/users/[id]` | GET, PUT, DELETE | User CRUD |
| `/api/activate` | POST | Account activation (set password) |
| `/api/change-requests` | GET, POST | Grower change requests |
| `/api/companies` | GET | Company list (for grower brand selector) |
| `/api/admin/commercie` | GET | Commercie/admin users (for account manager selector) |
| `/api/fust/types` | GET | Fust types catalog |
| `/api/fust/settings` | GET, PUT | Fust settings (auto-approve threshold) |
| `/api/fust/dashboard` | GET | Fust dashboard KPIs |
| `/api/fust/orders` | GET, POST | Fust orders (soft-delete filtered) |
| `/api/fust/orders/[id]` | GET, PATCH, DELETE | Order detail, approve/reject/cancel, soft delete |
| `/api/fust/pickups` | GET, POST | Pickup management |
| `/api/fust/pickups/[id]` | GET, PATCH | Pickup status + link orders |
| `/api/fust/deliveries/[id]` | PATCH | Confirm delivery (triggers grower email) |
| `/api/fust/invoices` | GET, POST | Invoice list and PDF upload |
| `/api/fust/invoices/[id]` | PATCH | Invoice status change |
| `/api/fust/invoices/[id]/charges` | POST | Create charges from invoice |
| `/api/fust/vouchers` | GET, POST | Issuance voucher list and PDF upload |
| `/api/fust/vouchers/[id]/match` | POST, DELETE | Match/unmatch voucher to orders |
| `/api/fust/audit` | GET | Audit log (filterable, paginated, role-scoped) |

### API Conventions
- All routes use `requireAuth()` for session check
- `resolveGrowerId()` for multi-tenant data access
- Zod validation on POST/PUT bodies
- Responses: `NextResponse.json(data)` or `NextResponse.json({ error }, { status })`
- Filters passed as query params (multi-value via `getAll`)

---

## Frontend Patterns

### Page Structure
Each portal page follows this pattern:
```
page.tsx         → Server component, auth check, renders content component in Suspense
*-content.tsx    → Client component ("use client"), fetches data, renders UI
```

### Data Fetching
```typescript
const { data, loading, error, lastUpdated, refetch } = useFetch<T>(url);
```
- `useFetch` is a custom hook that handles loading/error states
- URL is built with `useMemo` to trigger refetch on param changes
- `refetch()` available for manual refresh

### State Management
- No global state library. URL search params (`?growerId=`) as source of truth for grower context.
- `useSearchParams()` for reading grower selection (requires Suspense boundary).
- Local component state for UI interactions.

### Formatting
All formatting uses `nl-NL` locale:
- `formatCurrency(1234)` → "€ 1.234"
- `formatNumber(1234)` → "1.234"
- `formatPrice(1.234)` → "€ 1,234"
- `formatDate(date)` → "15-03-2026"

### Translations
```typescript
const { t } = useLanguage();
t("nav.dashboard")  // → "Dashboard" (en) or "Dashboard" (nl)
t("forecasts.title") // → "Shipment Forecasts" or "Aanvoerplanning"
```
Type-safe: `t()` accepts only keys that exist in the JSON files.

---

## Key Features

### Dashboard
- **Grower view**: KPI cards (stems today/yesterday/YTD, turnover, avg price, net yield, quality rate), sales chart, top products, recent lots.
- **Aggregate view** (admin/commercie, no grower selected): Company-wide KPIs, top growers table (clickable), top products, upcoming forecast summary.

### Sales Analytics
- Period filters: today, yesterday, this week, this month, YTD, custom date range
- Multi-select filters: product, sales channel, stem length
- Charts: price trend per product, stem length breakdown, channel distribution over time
- All charts respect active filters

### Shipment Forecasts
- Weekly grid: 6 weeks visible, inline number editing per cell
- Year overview chart (Recharts AreaChart): all products as colored areas, clickable weeks navigate the table
- Auto-save per cell with status indicators (saving/saved/error)
- Add products from lot history or custom names
- Copy week data to subsequent weeks
- CSV export
- Past weeks are read-only

### Grower Management
- Grower profiles with certificates
- Account activation via email link
- Commercie assignment
- Change request system
- Multi-company branding (Company entity with custom logos, email from-addresses)

### Fust Management
- **Webshop**: Growers order fust containers from a catalog (FustType with categories: emmers, karren, kratten, dozen, opzetrekken, overig)
- **Auto-approve**: Orders below a configurable threshold are auto-approved
- **Pickups**: Transporteurs group approved orders into pickups, mark as picked up
- **Deliveries**: 1:1 with orders. Transporteur confirms delivery with actual quantities → triggers email to grower
- **Invoices**: Finance uploads transporter invoices (PDF parsed), approves/rejects, creates charges
- **Vouchers**: Auction issuance vouchers (PDF parsed) matched to orders for reconciliation
- **Audit trail**: All fust actions logged to FustAuditLog (19 event types). Per-order timeline UI + admin activity page
- **Soft delete**: FustOrders use deletedAt/deletedById instead of hard delete
- **Two portals**: `(portal)/fust/` for grower/admin/commercie/finance, `(fust-portal)/fust-portal/` for transporteurs (standalone FustShell layout)

### Email Notifications
- **Account activation**: Credentials email to new users (all roles)
- **Password reset**: Reset link email
- **Fust order approved**: Email to transporter when order is approved (includes items, requested date)
- **Fust delivery confirmed**: Email to grower when transporter confirms delivery (includes ordered vs delivered quantities)
- **Fust grower invoice**: Invoice PDF attached, sent to grower with amount summary

All fust emails (order approved, delivery confirmed, invoice) respect the recipient's `preferredLanguage` setting (EN/NL). Subjects, body text, button labels, and date formatting adapt accordingly. Activation and password reset emails are English-only (out of scope).

---

## Development

### Commands
```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npx prisma db push   # Push schema changes (NOT migrate dev)
npx prisma generate  # Generate Prisma client (stop dev server first on Windows!)
npx tsx prisma/seed.ts  # Seed test database
```

### Environment Variables
```
DATABASE_URL=        # Neon pooler connection string
DIRECT_URL=          # Neon direct connection (for schema push)
NEXTAUTH_SECRET=     # NextAuth JWT secret
NEXTAUTH_URL=        # App URL
APP_URL=             # Public app URL
NEXT_PUBLIC_IS_TEST= # "true" for test environment banner
```

### Demo Accounts (test environment)
```
Admin:        admin@coloriginz.com        / Colori2026!
Commercie:    iris.inkoper@coloriginz.com  / FloraDesk#24
Grower:       pcfup@example.com            / GreenField99
Transporteur: chauffeur@flowertrans.nl     / Transport#2026
Finance:      finance@coloriginz.com       / Finance#2026
```

### Important Notes
- **Windows EPERM**: Stop dev server before running `prisma generate` (DLL lock).
- **Never run `next build` while dev server is running** - breaks CSS output.
- **Never use `vercel deploy`** - use `git push` to deploy (avoids leaking .env).
- **Database changes**: Use `prisma db push`, not `prisma migrate dev`.
- **Emails**: Use CID inline attachments (base64 Buffer), never external image URLs.
- `useSearchParams()` requires Suspense boundary.

---

## Deployment

- **Platform**: Vercel with two deployment targets
- **Test**: Auto-deploys from `develop` branch
- **Production**: Deploys from `main` branch
- **Database**: Separate Neon projects for test and production (not Neon branches)
- `vercel.json` runs `prisma generate` before build
- Never push directly to `main` without approval

---

## File Naming Conventions
- Page components: `page.tsx` (server) + `*-content.tsx` (client)
- API routes: `route.ts`
- UI components: kebab-case (`multi-select-filter.tsx`)
- Lib files: kebab-case (`api-helpers.ts`)
- Translation keys: dot-notation (`forecasts.copyWeek`)

---

## Key Design Decisions

| Decision | Chosen | Why | Alternatives considered |
|----------|--------|-----|------------------------|
| **ORM** | Prisma 6 (not 7) | Stable, mature driver adapter support for Neon serverless. Prisma 7 has breaking changes and required driver adapters that are unstable. | Drizzle (less mature ecosystem at time of decision) |
| **Auth** | NextAuth v5 + JWT + Credentials | Simple, no external auth provider dependency. Growers are invited by admin, not self-registering. JWT avoids DB session lookups. | Azure AD SSO (deferred — would add complexity for growers who don't have Microsoft accounts) |
| **Database** | Neon serverless PostgreSQL | No Docker available on dev workstation. Neon gives Postgres without local install. Two separate Neon projects for test/prod (not branches). | Supabase (more opinionated, auth overlap), local PostgreSQL (Docker not available) |
| **Deployment** | Vercel via `git push` only | CLI deploy (`vercel deploy`) leaks `.env` files to the build. Git push is the only safe method. | Vercel CLI (rejected due to env leak risk) |
| **Schema migrations** | `prisma db push` (not `migrate dev`) | Simpler for a small team. No migration history to manage. Both environments are pushed separately. | Prisma Migrate (overhead not justified yet) |
| **Multi-tenancy** | URL param `?growerId=` + role check | Growers see only own data (enforced by `resolveGrowerId`). Admin/commercie pass growerId as query param. No subdomain routing for grower tenancy. | Subdomain-per-grower (overkill), database-per-tenant (overkill) |
| **Multi-company branding** | Company entity in DB + base64 logos in code | Logos embedded as base64 in `company-logos.ts` for CID email attachments. Company determines email from-address, footer text, portal name. | External logo URLs (don't work in Ethereal, fragile in email clients) |
| **Fust portal isolation** | Separate route group `(fust-portal)` with FustShell layout + middleware URL rewrite for `fust.*` domains | Transporteurs get a standalone portal with its own nav, login page, and layout. Middleware rewrites `fust.domain.com/*` to `/fust-portal/*`. Shares the same API routes. | Separate Next.js app (deployment overhead), iframe embedding (poor UX) |
| **Email templates** | Inline HTML with VML for Outlook + language parameter | VML `<v:roundrect>` in `<!--[if mso]>` conditionals for Outlook button rendering. Inline translation maps per template function (not i18n JSON — email text is not UI text). | React Email (added dependency), MJML (build step) |
| **Fust soft delete** | `deletedAt` + `deletedById` on FustOrder | Orders are never truly deleted — audit trail and voucher links must persist. All queries filter `deletedAt IS NULL` by default. | Hard delete + cascade (loses audit history) |
| **Audit trail** | Denormalized `FustAuditLog` with `orderId` column | `orderId` is denormalized from the entity for fast per-order timeline queries without joins. 19 action types cover the full fust lifecycle. | Generic audit table without orderId (slow timeline queries), event sourcing (overkill) |
| **PDF parsing** | `pdfjs-dist` v4 legacy build | Works on Vercel serverless with `serverExternalPackages` + `outputFileTracingIncludes` config. v5 lacks type declarations for legacy build. | pdf-parse (wrapper, less control), unpdf (same underlying lib) |
| **i18n** | Custom JSON system with type-safe keys | No build step, full TypeScript inference via `NestedKeyOf` utility type. Only EN/NL for now. Email templates use separate inline translation maps. | next-intl (heavier), i18next (runtime overhead) |

---

## Business Domain and Operational Rules

### Consignment Model
- Growers ship flowers to Coloriginz in the Netherlands
- Coloriginz sells on behalf of growers at auction (VBA, VPL) or via direct sales
- After sale, Coloriginz creates a **salessheet** — an invoice grouping all lots from a shipment
- Salessheet shows: total turnover, itemized costs (commission, handling, logistics), net result
- The grower receives the net result minus costs
- **Key grower metric:** net yield per stem (netto opbrengst/steel) — what the grower keeps after all deductions

### Sales Data Hierarchy
```
SalesSheet (invoice) → Lot (batch of flowers) → Transaction (individual sale)
```
- One salessheet groups multiple lots from the same delivery
- One lot can have multiple transactions (sold at different prices/channels/dates)
- Transactions can be **corrections** (handling shortages, stock check adjustments) — flagged via `isCorrection`
- Lot costs are calculated from the lot's `refNumber` linking to salessheet cost lines

### Sales Channels
- **Direct sales**: Sold directly to buyers, typically higher margin
- **VBA**: Flora Holland auction (Aalsmeer)
- **VPL**: Flora Holland auction (Naaldwijk)
- **Production**: Internal/production use

### Quality Codes
Standard auction quality codes (110, 120, 130, 154, 160, 170) with descriptions. Mapped in `quality-codes.ts`. Quality rate = percentage of stems without quality issues.

### Season Calculation
- Each grower has a configurable `seasonStartMonth` (default: January)
- "Season to Date" (STD) calculations use this month as the start of the current season
- Relevant for Southern hemisphere growers whose season doesn't align with the calendar year

### Fust Lifecycle
```
Grower places order → [auto-approve or manual approve] → Transporter picks up from auction →
Transporter delivers to grower → Finance matches vouchers → Finance creates grower invoice → Payment
```

**Order statuses:** pending → approved → scheduled → in_transit → delivered (or rejected/cancelled at any point)

**Key rules:**
- Fust must be enabled per grower by admin (requires a default transporter)
- Auto-approve: if enabled for a grower, orders are approved instantly without commercie review
- Delivery confirmation captures actual quantities (may differ from ordered)
- Issuance vouchers (uitgiftebonnen) from the auction are PDF-parsed and matched to orders for reconciliation
- Grower invoices include deposit (statiegeld) and rental (fusthuur) line items per fust type
- Article codes (2907 for deposit, 2908 for rental) are configurable per fust type for Exact Globe compatibility

### Multi-Company Branding
- Growers belong to a Company entity (Coloriginz, OZ Import, MyPeony, etc.)
- Company determines: logo, email from-address, email sender name, footer text
- Default company branding is used when grower has no company assigned
- Logos are stored as base64 in code for CID email attachment (works across all email clients)

---

## Security Considerations

### Authentication
- Credentials-based auth via NextAuth v5 with JWT strategy
- Passwords hashed with bcryptjs (no plain text storage)
- Users are created by admin and receive activation link — no self-registration
- Activation tokens are single-use (`activationToken` column, cleared after use)
- Password reset tokens expire after 1 hour (`resetTokenExpiry`)
- JWT contains: user ID, role, growerId, transporterId — verified server-side on every API call

### Authorization
- Every API route starts with `requireAuth(allowedRoles?)` — returns 401/403 before any data access
- `resolveGrowerId()` ensures growers can only access their own data (role-based enforcement, not just frontend hiding)
- Admin/commercie/finance can view any grower's data by specifying `?growerId=`
- Transporteur users are scoped to their linked Transporter entity

### Data Isolation
- Grower data isolation is enforced at the API layer, not the database layer (no row-level security)
- All grower-scoped queries include `growerId` in the WHERE clause
- Fust audit log captures actor identity for all actions

### Sensitive Data
- No credit card or payment data stored
- Passwords: bcrypt hashed, never logged or returned in API responses
- Activation/reset tokens: UUID-based, single-use, stored hashed equivalent (unique column)
- Demo account passwords are in CLAUDE.md — acceptable for test environment only

### Email Security
- Test environment: Ethereal (emails never reach real inboxes) or redirect mode (all emails go to one configurable address)
- Production: Resend SMTP — real emails only in production
- Email mode controlled by `NEXT_PUBLIC_APP_ENV` and admin-configurable settings

### Known Security Limitations
- No rate limiting on login attempts (acceptable for invite-only user base, but should be added if public registration is ever introduced)
- No CSRF protection beyond NextAuth defaults (JWT-based, so not vulnerable to traditional CSRF)
- No Content Security Policy headers configured
- API routes do not validate `growerId` format beyond Zod UUID check (no ownership verification beyond role check)

---

## Known Issues and Technical Debt

### Known Issues
- **Next.js 16 Turbopack on Windows**: Crashes with `0xc0000142`. Workaround: use `npx next dev --webpack` as fallback.
- **Prisma generate on Windows**: DLL lock when dev server is running. Must stop dev server first.
- **Test mode role switching**: JWT-based, so original role is only restored on re-login. Edge cases when switching between grower and transporter roles.

### Technical Debt
- **No automated tests**: No unit tests, integration tests, or E2E tests. Manual testing only. Critical for a portal handling financial data.
- **No data import pipeline**: Sales data (lots, transactions, salessheets) is currently seeded. No API or ETL pipeline for importing from the source system (ERP/Qlik).
- **Activation flow not E2E tested**: Code exists but has not been tested with real email delivery in production.
- **Hardcoded Exact Globe article codes**: Deposit (2907) and rental (2908) article codes are defaults per fust type but the mapping is not validated against Exact Globe.
- **No pagination on several endpoints**: Dashboard, quality, and some fust endpoints return all records. Acceptable at current scale but will need pagination as data grows.
- **`tAny` casts in fust-settings.tsx**: Some translation keys are cast via `t as unknown as (key: string) => string` to bypass type checking for dynamic keys. Should be properly typed.

### Workarounds
- **Vercel serverless + public/ folder**: Serverless functions cannot access `public/` at runtime. Logos and images needed in emails are embedded as base64 strings in code (`company-logos.ts`).
- **pdfjs-dist on Vercel**: Requires legacy build import path (`pdfjs-dist/legacy/build/pdf.mjs`), `serverExternalPackages`, and `outputFileTracingIncludes` in next.config.

---

## Open Questions and Missing Information

- **Data import strategy**: How will production data (salessheets, lots, transactions) be imported? Flat file upload, API push from ERP, or database sync? This is the biggest gap before the portal can go live for real grower usage.
- **Exact Globe integration**: How far should the XML invoice export go? Currently generates basic XML. Does it need specific field mappings, validation, or direct API push?
- **Grower onboarding flow**: Who creates grower accounts in production? Is there a bulk import from ERP, or one-by-one via admin UI?
- **Audit data retention**: How long should fust audit logs be kept? Currently no cleanup policy.
- **Scalability**: At what grower/transaction volume will the current architecture need optimization? (No pagination on some endpoints, no caching layer, no CDN for static assets beyond Vercel defaults.)
- **Spanish/Portuguese i18n**: Planned for Colombia/Ecuador/Brazil growers. When is this needed? Requires extending both UI translations and email templates.
- **Claim management workflow**: Growers should be able to dispute quality issues. Designed but not yet built. Priority unclear.
- **Notification preferences**: Beyond `preferredLanguage`, should growers be able to opt out of specific email notifications?
