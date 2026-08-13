# Multi-Company Branding: Coloriginz + MyPeony

## Fase 1: Foundation
- [x] 1a. Prisma: Company model + Grower.companyId
- [x] 1b. company-config.ts (static domain→slug mapping, edge-compatible)
- [x] 1c. Logo bestanden (public/logos/)
- [x] 1d. Email logo base64 (company-logos.ts)
- [x] 1e. CompanyBrandingProvider (React context)
- [x] 1f. Middleware: x-company-slug header

## Fase 2: UI Branding
- [x] app-shell.tsx: dynamic logo
- [x] login-content.tsx: dynamic logo
- [x] fust-login-content.tsx: n.v.t. (uses icon, no company logo)
- [x] fust-shell.tsx: n.v.t. (uses icon, no company logo)
- [x] activate/page.tsx: server-side company
- [x] reset-password/page.tsx: server-side company
- [x] forgot-password/page.tsx: dynamic logo
- [x] layout.tsx: dynamic metadata

## Fase 3: Email Branding
- [x] 3a. company-helpers.ts: getGrowerEmailBranding()
- [x] 3b. Email templates: branding parameter
- [x] 3c. sendEmail: optional from parameter
- [x] 3d. API routes: company branding meegeven

## Fase 4: Admin Features
- [x] Companies API route
- [x] Grower CRUD: companyId in create/update/get
- [x] Grower lijst: Brand kolom
- [x] Grower detail: Company selector
- [x] Grower create dialog: Company selector
- [x] Grower selector: companyEntity in data

## Verificatie
- [x] npm run build succesvol
