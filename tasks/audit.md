# Code Audit — Grower Portal (23 mei 2026)

Volledige audit door 6 gespecialiseerde agents: Security, Database/Performance, API Layer, Frontend, Business Logic, Architecture/Code Quality.

**Totaal: 11 CRITICAL, 26 HIGH, 35 MEDIUM, 18 LOW**

---

## CRITICAL — Direct actie vereist

### 1. JWT Role Escalation in Productie
- **File**: `src/lib/auth.ts:79-101`
- **Probleem**: JWT callback verwerkt `switchRole` zonder `isTest` guard. Client-side `session.update({ switchRole: "admin" })` werkt in productie.
- **Fix**: Voeg `isTest` check toe in JWT callback, niet alleen in API route.
- **Effort**: S

### 2. Custom Date Range Sluit Einddatum Uit
- **File**: `src/app/api/sales/route.ts:62`
- **Probleem**: `startOfDay(new Date(toParam + "T23:59:59"))` reset tijd naar 00:00:00. Alle transacties OP de einddatum worden uitgesloten.
- **Impact**: Growers zien te lage omzet bij custom datumbereik.
- **Fix**: `endOfDay(new Date(toParam))` met `lte`, of `addDays(startOfDay(...), 1)` met `lt`.
- **Effort**: S

### 3. Dashboard Net Yield Gebruikt Niet-Matchende Datumbronnen
- **File**: `src/app/api/dashboard/route.ts:78,91,116`
- **Probleem**: Turnover van `Transaction.date` minus costs van `SalesSheet.invoiceDate`. Een salessheet van jan kan transacties van dec bevatten.
- **Impact**: Het belangrijkste KPI voor growers (netto opbrengst per steel) is potentieel significant fout.
- **Fix**: Gebruik `SalesSheet.netResult` geaggregeerd op `invoiceDate`.
- **Effort**: M

### 4. YoY Vergelijking Negeert Actieve Filters
- **File**: `src/app/api/sales/route.ts:244-248`
- **Probleem**: `lyBaseWhere` past `filterProducts`, `filterStemLengths`, `filterGrowerIds` niet toe. Vorig jaar toont alle producten terwijl dit jaar gefilterd is.
- **Impact**: Misleidende groei/daling percentages.
- **Fix**: Pas dezelfde lot-filters toe op `lyBaseWhere`.
- **Effort**: S

### 5. Timing Attack op Import API Keys
- **Files**: `src/lib/import-auth.ts:23`, `src/app/api/fust/vouchers/import-email/route.ts:23`
- **Probleem**: `token !== apiKey` is kwetsbaar voor character-by-character timing analysis.
- **Fix**: `crypto.timingSafeEqual()`.
- **Effort**: S

### 6. Publieke Blob URLs voor Financiele Documenten
- **Files**: Alle `put()` calls met `access: "public"` (6 locaties: documents, invoices, vouchers, grower-invoices, salessheets)
- **Probleem**: Iedereen die de URL kent kan financiele documenten downloaden.
- **Fix**: `access: "private"` + authenticated API routes met signed URLs.
- **Effort**: M

### 7. Fust Types Endpoint Zonder Authenticatie
- **File**: `src/app/api/fust/types/route.ts`
- **Probleem**: Enige route zonder `requireAuth()`. Prijsinformatie publiek.
- **Fix**: Voeg `requireAuth()` toe.
- **Effort**: S

### 8. Admin Settings Zonder Rolbeperking of Validatie
- **File**: `src/app/api/admin/settings/route.ts:40`
- **Probleem**: Elke ingelogde gebruiker kan willekeurige settings upserten. Geen Zod, geen role check.
- **Fix**: `requireAuth(["admin"])` + Zod schema met key whitelist.
- **Effort**: S

### 9. request.json() Zonder try/catch in 35+ Routes
- **Files**: 35+ POST/PUT/PATCH routes
- **Probleem**: Malformed JSON body geeft 500 i.p.v. 400. Alleen `shipments/import-email` doet dit correct.
- **Fix**: Maak `parseJsonBody<T>(request, schema)` helper.
- **Effort**: M

### 10. Fust Invoice Charges Kunnen Dubbel Aangemaakt
- **File**: `src/app/api/fust/invoices/[id]/charges/route.ts:48-99`
- **Probleem**: Geen check of invoice al charges heeft. Twee keer klikken = dubbele facturatie aan growers.
- **Fix**: Check `invoice.status !== "charged"` voor creatie.
- **Effort**: S

### 11. Fust Order Status Transitions Niet Gevalideerd
- **File**: `src/app/api/fust/orders/[id]/route.ts:78-90`
- **Probleem**: Alleen target status per role gevalideerd, niet current→target. `delivered→approved` is mogelijk.
- **Fix**: Transition map: `{ pending: ["approved","rejected","cancelled"], approved: ["scheduled","cancelled"], ... }`.
- **Effort**: M

---

## HIGH — Binnen 1-2 sprints

### Security (5)
- **Activation tokens zonder verloopdatum** (`src/app/api/activate/route.ts`) — geen expiry, eeuwig geldig
- **Activation token in API responses** (admin/users POST, suppliers/activate) — moet alleen via email
- **JWT geen custom maxAge** (`src/lib/auth.ts:51`) — 30d default, geen check of user nog actief
- **Hardcoded API key in 6 scripts** — scripts/backfill.ts, submit-*.js etc.
- **Transporteur status filter bypass** (`src/app/api/fust/orders/route.ts:74`) — `?status=pending` overschrijft role filter

### Performance (4)
- **Dashboard chart: 24 sequentiele queries** (`dashboard/chart/route.ts:77-99`) — single GROUP BY
- **Sales route laadt ALLE transacties in memory** (`sales/route.ts:167-171`) — SQL aggregatie
- **Sales trends haalt ALLE transacties+lots** (`sales/trends/route.ts:59-69`) — SQL aggregatie
- **Forecast upserts: sequentiele loop** (`forecasts/route.ts:137-179`) — bulk INSERT ON CONFLICT

### API (5)
- **Finance role geen supplier scope** (`fust/orders/route.ts:61-66`)
- **Order number race condition** (`fust/orders/route.ts:21-37`) — concurrent = duplicates
- **Invoice status transitions niet gevalideerd** — paid→pending mogelijk
- **Grower invoice status niet gevalideerd** — paid→draft mogelijk
- **Pickup POST admin: willekeurige eerste transporter** (`fust/pickups/route.ts:87-93`)

### Frontend (4)
- **useFetch: geen AbortController** (`hooks/use-fetch.ts:27`) — race condition bij snelle filterwisseling
- **Geen error boundaries** — geen `error.tsx`, crash = witte pagina
- **setState during render** (`sales-content.tsx:159-163`)
- **setState in useEffect** (`forecasts-content.tsx:125-147`) — potentiele infinite loop

### Business Logic (1)
- **Forecasts: geen server-side past-week validatie** — API accepteert wijzigingen aan verleden weken

### Architecture (4)
- **CLAUDE.md volledig verouderd** — "grower" i.p.v. "supplier" overal
- **Geen env var validatie bij startup** (`src/lib/env.ts` = 2 regels)
- **30+ eslint-disable @typescript-eslint/no-explicit-any**
- **FustType interface 13x gedupliceerd** — maak shared types

---

## MEDIUM (35 items)

<details>
<summary>Klik om uit te klappen</summary>

### Security
- Transporteur ziet audit logs van alle suppliers
- Pickup GET geen entity scoping
- Fust dashboard aggregate toont cross-company data
- Geen file size limit op uploads
- Document upload geen supplier ownership check voor commercie
- Password change geen Zod validatie
- Import routes lekken stack traces (throw na logging)

### Database
- Missing index `Supplier.accountManagerCode` (elke commercie call)
- Missing index `Transaction(lotId, date)`
- Missing indexes `FustIssuanceVoucherItem(voucherId)`, `FustInvoiceItem(invoiceId)`

### API
- Pickup POST/PATCH linkt orders zonder status check
- Change requests open voor transporteur/finance
- Transporters endpoint voor alle rollen
- Fust dashboard aggregate geen supplier scope
- Import routes re-throw i.p.v. JSON error response
- Activation token niet time-limited (eerder audit: nog steeds open)
- Admin user DELETE geen FK constraint handling

### Frontend
- LanguageProvider recreert translator bij elke call
- NavContent als functie in render = unmount/remount
- Forecasts grid O(n) lookup per cell — gebruik Map
- Forecast year chart O(n) lookup per cell
- Hardcoded Engelse strings (dashboard, sales, imports, supplier-selector)
- i18n type safety bypass: `tAny` (9x), `as Parameters<typeof t>[0]` (160x)
- Inconsistent fetch patterns (useFetch vs manual)
- Debounce timer in state i.p.v. ref (fust-email-log.tsx)
- Vouchers zonder paginatie
- Date inputs zonder aria-labels
- Forecast inputs zonder aria-labels
- eslint-disable react-hooks/exhaustive-deps hiding stale closures
- Suppliers fetched separately in multiple components (no cache)

### Architecture
- Email template HTML boilerplate 5x gedupliceerd
- Unused npm deps (strip-bom, ws, nuqs, tailwind-variants, react-day-picker, msgreader)
- Session role typed als `string` i.p.v. union type
- Silent catch blocks in import routes
- portalUrl 4x herhaald
- @types/nodemailer in dependencies i.p.v. devDependencies

</details>

---

## Positieve Bevindingen

- Alle session-based routes hebben `requireAuth()` ✓
- `resolveSupplierId()` correct: growers zien alleen eigen data ✓
- Passwords: bcrypt met 12 rounds ✓
- Forgot-password lekt geen user existence ✓
- Reset tokens: expiry + single-use invalidation ✓
- `.env*` in `.gitignore` ✓
- `$executeRawUnsafe` gebruikt parameterized queries — geen SQL injection ✓
- Import routes: excellente bulk SQL patterns ✓
- Dashboard: 8 queries parallel met `Promise.all` ✓
- Grower invoice creatie: transactioneel ✓
- Prisma singleton: correct voor serverless ✓

---

## Top 10 Actiepunten (prioriteit)

| # | Actie | Impact | Effort |
|---|-------|--------|--------|
| 1 | JWT role escalation fix | Privilege escalation in prod | S |
| 2 | Custom date range bug | Verkeerde omzetcijfers | S |
| 3 | Dashboard net yield fix | Fout KPI | M |
| 4 | YoY filters doorvoeren | Misleidende vergelijking | S |
| 5 | AbortController in useFetch | Stale data race condition | S |
| 6 | Fust order status transitions | Data corruptie | M |
| 7 | Blob uploads private maken | Financiele docs publiek | M |
| 8 | Sales route SQL aggregatie | Performance bij schaal | M |
| 9 | error.tsx toevoegen | Witte pagina bij crash | S |
| 10 | Timing-safe API key comparison | Key enumeration risk | S |
