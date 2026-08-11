# Microsoft Entra SSO — Grower Portal

> **Status:** code staat klaar, provider staat uit. Wacht op App Registration van IT.
> **Aangelegd:** 11 augustus 2026
> **Achtergrond:** de gids [Microsoft Entra ID aansluiten](https://design-system.apps.coloriginz.com/gidsen/entra-sso)
> van het Coloriginz Design System. Dit document beschrijft alleen wat voor déze portal
> anders of extra is; de gids herhalen heeft geen zin.

---

## 1. Wat er anders is dan bij de referentie-implementatie

De gids is geschreven vanuit de Onboarding Portal, een interne app. Deze portal is dat niet.

**Van de vijf rollen zitten er maar drie in de tenant.** `admin`, `commercie` en `finance` zijn
Coloriginz-personeel. `supplier` (kwekers wereldwijd) en `transporteur` komen niet in de tenant en
zullen daar ook nooit in komen. Daaruit volgt:

- De wachtwoordlogin blijft permanent het hoofdpad. De gids adviseert die werkend te houden
  "zolang er nog ontwikkeld wordt"; hier is dat geen tijdelijke maatregel.
- De `signIn`-callback weigert een account waarvan de rol niet in `SSO_ROLES` staat, ook als het
  e-mailadres klopt. Een kweker- of transporteuraccount dat op een tenant-identiteit matcht
  betekent dat er iets mis is, niet dat iemand mag inloggen.
- Het fust-portaal (`/fust-login`, de `fust.*`-domeinen) krijgt geen SSO-knop en dus ook geen
  redirect URI. Dat is puur transporteurs.

**We stonden al op Auth.js v5.** Het zwaarste advies uit §5 van de gids — begin niet op v4 — was
al ingevuld. Ons provider-id is daarom `microsoft-entra-id`, niet `azure-ad`. Dat verschil zit in
de redirect URI, dus neem nooit een URI-lijst over van de Onboarding Portal.

**Rollen kwamen al uit onze eigen database.** Wat §4 eist deden we al; er is niets aan gewijzigd.

---

## 2. De vier beslissingen (gids §3)

| | Gids | Hier |
|---|---|---|
| §3.1 SSO maakt geen accounts | verplicht | zo gebouwd |
| §3.2 identiteitsclaim | `email ?? preferred_username ?? upn` | zo gebouwd, lowercase, `mode: "insensitive"` |
| §3.2 `oid` vastleggen | aanbevolen | `User.entraOid`, nullable + uniek, best-effort geschreven |
| §3.3 auto-activatie | portal doet het, mits `deactivatedAt` bestaat | zo gebouwd, met `User.deactivatedAt` |
| §3.4 foutcodes | redirect met code, allowlist aan de leeskant | zo gebouwd, Engelse codes |

### Auto-activatie en `deactivatedAt`

`User.isActive` dekte twee toestanden: "uitgenodigd, nooit geactiveerd" (zo wordt een gebruiker
aangemaakt) en "uitgezet door een beheerder" (de knop in `user-management.tsx`). Auto-activeren
zonder die te scheiden maakt precies de fout uit §3.3: een uitgezette collega loopt via Microsoft
weer binnen.

`User.deactivatedAt DateTime?` scheidt ze, volgens dezelfde tabel als de gids:

| `isActive` | `deactivatedAt` | betekenis | SSO |
|---|---|---|---|
| `false` | `null` | uitgenodigd, nooit geactiveerd | activeren en toelaten |
| `false` | gezet | uitgezet door een beheerder | weigeren (`AccountDeactivated`) |
| `true` | `null` | actief | toelaten |

Drie plekken houden het tijdstempel bij, want een blijven staan stempel sluit een heractiveerd
account buiten en een ontbrekend stempel laat een uitgezet account binnen:

- `PATCH /api/admin/users/[id]` zet hem bij `isActive: false` en wist hem bij `true`
- `POST /api/activate` wist hem — het account is weer in gebruik
- de `signIn`-callback wist hem bij auto-activatie, en gooit meteen `activationToken` weg: een
  openstaande uitnodigingslink hoort dood te zijn zodra het account langs een andere weg in
  gebruik is genomen

**Bestaande rijen moeten verdeeld worden** met `scripts/backfill-user-deactivated-at.ts`, en wel
vóórdat de provider aangaat. Zonder backfill ziet een uitgezet account eruit als een uitgenodigd
account. De heuristiek is die van de gids: wie ooit een wachtwoord heeft gezet, is uitgezet; wie
er geen heeft, is nooit begonnen. Als tijdstempel gebruikt het script `updatedAt`, wat dichter bij
de waarheid ligt dan het moment van draaien.

`decideEntraSignIn` heeft daarnaast een vangnet: een inactief account mét wachtwoord wordt ook
zonder tijdstempel geweigerd. Dat is dezelfde heuristiek, maar dan tijdens het inloggen. Na een
correcte backfill kan hij nooit meer afgaan; tot die tijd voorkomt hij dat een vergeten migratie
de zijdeur openzet.

Twee dingen uit de gids gelden bij ons **niet**:

- De soft-delete-val niet: onze DELETE-route is een echte `prisma.user.delete`, dus een
  verwijderde gebruiker kan niet via SSO terugkomen.
- Het doodlopende "wachtwoord vergeten"-pad niet: onze `forgot-password` kijkt naar `isActive` en
  niet naar `passwordHash`, dus een SSO-gebruiker zonder wachtwoord krijgt gewoon een resetmail.

---

## 3. Wat er in de code staat

| Bestand | Wat |
|---|---|
| `src/lib/entra-sign-in.ts` | Pure beslissingsfunctie `decideEntraSignIn`, claimresolutie, foutcodes, `SSO_ROLES`, `ENTRA_PROVIDER_ID` |
| `src/lib/auth.ts` | Provider achter `entraEnabled`, `signIn`-callback, `jwt`-callback vult uit de database |
| `src/app/login/page.tsx` | Geeft `entraEnabled` server-side door |
| `src/app/login/login-content.tsx` | Knop, scheidingslijn, foutcodes tegen een allowlist |
| `src/components/auth/sso-button.tsx` | `@col/sso-button` 1.0.0 — beheerd bestand, niet lokaal aanpassen |
| `prisma/schema.prisma` | `User.entraOid String? @unique`, `User.deactivatedAt DateTime?` |
| `scripts/backfill-user-deactivated-at.ts` | Verdeelt bestaande rijen over uitgenodigd/uitgezet |

De beslissingsfunctie staat bewust los van NextAuth en van Prisma: de regels zijn het
interessante deel en die horen leesbaar en toetsbaar te zijn zonder request of database. Dat is
ook de vorm die de gids in §5 voorziet voor een toekomstig gedeeld item.

`components.json` is gekoppeld aan de registry (`@col`), dus updates van de knop haal je op met
`npx shadcn add @col/sso-button --overwrite`.

### Env-vars

Drie, en de provider verschijnt pas als ze **alle drie** gezet zijn:

```
AUTH_MICROSOFT_ENTRA_ID_ID=<client id>
AUTH_MICROSOFT_ENTRA_ID_SECRET=<secret — alleen in Vercel en lokale .env>
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/29ebd335-b1bc-4b1d-b89b-ea6e27378762/v2.0
```

Zet ze in Vercel op **Preview én Production**. Zolang ze ontbreken staat de knop niet op de
loginpagina en gedraagt de portal zich exact als nu — dat is met opzet, zodat dit veilig naar
`develop` kan voordat IT geleverd heeft.

---

## 4. Openstaand

- [x] Domeinlijst vaststellen (§5 hieronder)
- [ ] App Registration aanvragen bij `systems@dfg.nl` (bijlage A van de gids, ingevuld hieronder)
- [ ] Admin consent aanvragen — aparte mail, bijlage B van de gids
- [ ] Env-vars in Vercel, preview + productie
- [ ] `npx prisma db push` voor `entraOid` en `deactivatedAt`, eerst test dan productie
- [ ] `npx tsx scripts/backfill-user-deactivated-at.ts --apply` — **vóór** de provider aangaat
- [ ] Testen op een preview-deployment; lokaal kan niet, localhost staat bewust niet in de URI's
- [ ] Vervaldatum van het secret in de agenda (24 maanden)

---

## 5. Redirect URI's

De vorm is `https://<host>/api/auth/callback/microsoft-entra-id`.

| Omgeving | Host | Status |
|---|---|---|
| Test | `growerportal.test.apps.coloriginz.com` | **zeker** — staat in de importscripts |
| Productie | `growerportal.apps.coloriginz.com` | **bevestigd** 11 aug 2026. Let op: `.env.production` wijst naar `col-growerportal.vercel.app`; die registreren we bewust niet, conform §2 van de gids |

Fust-domeinen staan er bewust niet bij: geen SSO voor transporteurs.

Wel nagekeken: de middleware herschrijft op een `fust.`-host alle paden naar `/fust-portal/...`,
maar laat `/api` expliciet met rust (`src/middleware.ts:29`). Callbacks komen dus overal goed aan;
het is puur een keuze om ze daar niet aan te bieden.

---

## Bijlage — mail aan IT

> Onderwerp: App Registration voor Grower Portal
>
> Hoi,
>
> Voor de Grower Portal willen we inloggen met het Microsoft-werkaccount, zodat collega's geen
> apart wachtwoord meer nodig hebben. Daarvoor is een App Registration nodig in onze tenant.
>
> Gevraagd:
>
> - Naam: Grower Portal
> - Type: single tenant (accounts alleen in deze organisatie)
> - Platform: Web
> - Redirect URI's:
>   - `https://growerportal.test.apps.coloriginz.com/api/auth/callback/microsoft-entra-id`
>   - `https://growerportal.apps.coloriginz.com/api/auth/callback/microsoft-entra-id`
> - API permissions (Microsoft Graph, delegated): `openid`, `profile`, `email`, `User.Read`
> - Client secret met een looptijd van 24 maanden
>
> Graag de Application (client) ID, de Directory (tenant) ID en het secret terugkoppelen. Het
> secret ontvang ik het liefst via een kanaal waar het niet blijft staan.
>
> De app vraagt alleen het profiel op van de gebruiker die inlogt (naam en e-mailadres), om te
> bepalen wie er binnenkomt. Geen toegang tot mail, agenda, bestanden of gegevens van andere
> gebruikers.
>
> Ter info: alleen interne medewerkers loggen via Microsoft in. Kwekers en transporteurs hebben
> een eigen account in de portal en blijven met e-mailadres en wachtwoord werken.
>
> Groet,
> Henk Pieter

Reken op een **tweede** mail voor admin consent; die staat als bijlage B in de gids en is volgens
de gids de meest voorkomende blokkade. Die kun je pas sturen als je de client-id hebt.
