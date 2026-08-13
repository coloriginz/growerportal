# Mobile-Friendly Portal — Design Spec

**Date:** 2026-05-20
**Status:** Approved
**Scope:** Make the grower portal usable on mobile devices for suppliers and transporters

---

## Context

The grower portal is a responsive web app built with Next.js, Tailwind CSS, and Recharts. The current codebase is approximately 60% mobile-ready: navigation (hamburger + Sheet sidebar), dashboard KPI grids, charts (ResponsiveContainer), and the lots page (card-based mobile view) already work well on small screens. However, most data tables, the fust portal, and several content pages lack dedicated mobile layouts and rely on horizontal scrolling (`overflow-x-auto`), which provides a poor experience on phones.

## Target Users

- **Suppliers (growers):** Check sales, lots, documents, and fust orders on the go. Read-only forecast viewing.
- **Transporters:** Manage pickups and deliveries from their phone while on the road.
- **Admin/commercie/finance:** Desktop-primary. Mobile should be "not broken" but does not need a polished mobile UX.

## Priorities

| Priority | Pages | Mobile approach |
|----------|-------|-----------------|
| P1 | Dashboard, Sales, Lots, Documents, Fust Orders (grower) | Card-based mobile view |
| P1 | Fust Portal (transporteur): My Orders, Pickups, Deliveries | Card-based mobile view |
| P2 | Quality, Profile, Suppliers list | Card-based mobile view |
| P3 | Admin (users, supplier detail, audit log, fabric relations) | Horizontal scroll, not broken |
| Skip | Forecasts editing | Read-only on mobile (hide grid, show simple list) |

## What Already Works (No Changes Needed)

- **Navigation:** Hamburger menu with Sheet-based sidebar on `< lg` screens. Closes on link click.
- **Dashboard KPI cards:** Responsive grid (`sm:grid-cols-2 lg:grid-cols-4`).
- **Charts:** All 6 chart components use `ResponsiveContainer width="100%" height={300}`. Charts stack vertically on mobile via `lg:grid-cols-2`.
- **Filter bars:** `flex flex-wrap` handles narrow screens naturally.
- **Lots page:** Already has the card-based mobile pattern (`hidden md:block` for table, `space-y-3 md:hidden` for cards).
- **Empty states and prompts:** Centered flex layouts, responsive by default.
- **Page headers:** Already responsive (`flex-col` on mobile, `sm:flex-row` on desktop).

## Design Pattern: Mobile Card View

Follow the existing pattern from the lots page (`src/app/(portal)/lots/lots-content.tsx`):

```tsx
{/* Mobile card view */}
<div className="space-y-3 md:hidden">
  {items.map((item) => (
    <div key={item.id} className="rounded-lg border p-4" onClick={...}>
      {/* 3-4 key fields in a compact layout */}
    </div>
  ))}
</div>

{/* Desktop table view */}
<div className="hidden md:block">
  <Table stickyHeader>
    {/* Full table with all columns */}
  </Table>
</div>
```

Rules:
- Breakpoint: `md` (768px) as the table/card switchover, consistent with existing pattern.
- Cards show 3-5 most important fields per row. Less is more.
- Clickable cards navigate to detail pages where applicable.
- Status badges, dates, and key numbers are always visible in the card.
- Action buttons (if any) are part of the card, not hidden in a menu.

## Per-Page Changes

### P1: Sales Page (`src/app/(portal)/sales/sales-content.tsx`)

**Current state:** Three tables (by sales type, by product, by grower) with no mobile card view. Period tabs, filter bar, and charts already work.

**Changes:**
- Add mobile card view for all three tables:
  - **By sales type:** Card showing sales type name, stems, turnover, avg price
  - **By product:** Card showing product name, stems, turnover, avg price
  - **By grower:** Card showing grower name, stems, turnover, avg price
- Period tabs: Already wrap via flex. If they overflow on very small screens, add `overflow-x-auto` with `flex-nowrap` as fallback.
- Table footers (totals): Show totals as a summary row above the mobile cards.

### P1: Fust Orders — Grower Side (`src/features/fust/components/fust-orders.tsx`)

**Current state:** Table with 8 columns, `overflow-x-auto` only, no mobile cards.

**Changes:**
- Add mobile card view showing: order number, requested date, status badge, items summary (e.g. "3x Emmer, 2x Kar"), total price.
- Action buttons (cancel, reorder) visible in the card.

### P1: Fust Portal — Transporteur Pages

**My Orders (`src/app/(fust-portal)/fust-portal/my-orders/`):**
- Card view: supplier name, requested date, status badge, item count.

**Pickups (`src/features/fust/components/fust-pickups.tsx`):**
- Card view: pickup date, number of orders, status badge. Tap to expand and see linked orders.

**Deliveries (`src/features/fust/components/fust-deliveries.tsx`):**
- Card view: supplier name, delivery date, status badge. Confirm button prominent on the card.

### P1: Documents (`src/app/(portal)/documents/documents-content.tsx`)

**Current state:** Likely a simple list/table. Check if it already works on mobile.

**Changes:**
- If table-based: add card view with document name, type, date, download button.
- If already card/list-based: verify it doesn't break on narrow screens.

### P2: Quality (`src/app/(portal)/quality/quality-content.tsx`)

**Changes:**
- Card view showing: lot reference, quality code + description, date, status.

### P2: Profile (`src/app/(portal)/profile/`)

**Current state:** Form-based page. Forms typically stack naturally on mobile.

**Changes:**
- Verify form fields stack properly. Fix any side-by-side layouts that break on mobile.

### P2: Suppliers List (`src/app/(portal)/suppliers/suppliers-content.tsx`)

**Current state:** Table with 9 columns (code, name, company, owner, country, AM, features, growers, status).

**Changes:**
- Card view showing: code + name (as title), owner, country, feature icons, status badge.

### Skip: Forecasts (`src/app/(portal)/forecasts/forecasts-content.tsx`)

**Changes:**
- Hide the editable weekly grid on mobile: `hidden md:block` on the grid container.
- Show a read-only list below: per product, show the next 4-6 weeks as a compact horizontal row of numbers.
- Year overview chart (AreaChart) already uses ResponsiveContainer, works fine.
- "Add product" and "Copy week" buttons hidden on mobile.

### P3: Admin Pages

**No card views.** Ensure tables don't break:
- Verify `overflow-x-auto` is present on all admin tables.
- Add `min-w-[800px]` on the inner `<Table>` if needed to ensure consistent horizontal scroll behavior.
- Pages: user management, supplier detail (feature toggles form), admin overview dashboard, fabric relations tab.

## Technical Approach

- **No new libraries.** Pure Tailwind responsive classes.
- **No new components.** Mobile cards are inline in the same content file as the desktop table.
- **No new routes.** Same pages serve both mobile and desktop.
- **Breakpoint:** `md` (768px) for table/card switchover.
- **Testing:** Chrome DevTools responsive mode (iPhone SE 375px, iPhone 14 390px, iPad Mini 768px).

## Out of Scope

- PWA / native app wrapper
- Separate mobile routes or layouts
- Touch gestures (swipe, pull-to-refresh)
- Bottom navigation bar (hamburger menu is sufficient)
- Forecast editing on mobile
- Offline support
- Mobile-specific features (camera, GPS, push notifications)

## Success Criteria

1. All P1 pages are usable on a 375px wide screen without horizontal scrolling.
2. Key information (sales totals, lot details, fust order status) is readable without zooming.
3. Navigation works smoothly (hamburger menu, page transitions).
4. Charts render correctly and are readable on mobile.
5. Transporteurs can confirm deliveries from their phone.
6. Admin pages don't visually break (horizontal scroll is acceptable).

## Estimated Scope

~12-15 files to modify. The pattern is repetitive (add `md:hidden` card view + `hidden md:block` on table) so each page is a similar chunk of work. The forecasts read-only view is the most novel piece.

## Files to Modify

| File | Change |
|------|--------|
| `src/app/(portal)/sales/sales-content.tsx` | Card views for 3 tables, period tabs overflow |
| `src/app/(portal)/documents/documents-content.tsx` | Card view if table-based |
| `src/app/(portal)/quality/quality-content.tsx` | Card view |
| `src/app/(portal)/forecasts/forecasts-content.tsx` | Hide grid on mobile, add read-only list |
| `src/app/(portal)/suppliers/suppliers-content.tsx` | Card view |
| `src/app/(portal)/profile/*` | Verify form stacking |
| `src/features/fust/components/fust-orders.tsx` | Card view |
| `src/features/fust/components/fust-pickups.tsx` | Card view |
| `src/features/fust/components/fust-deliveries.tsx` | Card view |
| `src/app/(fust-portal)/fust-portal/my-orders/*` | Card view |
| Various admin pages | Verify `overflow-x-auto`, add `min-w` if needed |
