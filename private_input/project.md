# Grower Portal — Projectbeschrijving

## Bedrijfscontext

Een bloemenimportbedrijf dat bloemen importeert van kwekers wereldwijd. Een deel wordt ingekocht (koop), een deel wordt verkocht namens de kweker (consignment). Bij consignment-partijen is het voor kwekers essentieel om te weten:

1. **Welke prijs** er voor hun bloemen wordt gemaakt
2. **Welke kosten** er worden afgetrokken (commissie, transport, etc.)
3. **Wat ze uiteindelijk betaald krijgen** voor de geleverde partijen

Momenteel ontbreekt een goed systeem hiervoor. Er was ooit een Qlik-dashboard (BI-tool) dat dit inzicht bood, maar dat was functioneel beperkt en visueel gedateerd.

## Doel

Een modern, gebruiksvriendelijk webportaal bouwen waar consignment-kwekers kunnen inloggen om real-time inzicht te krijgen in hun partijen en financiele afwikkeling. Het portaal vervangt het oude Qlik-dashboard en biedt een professionelere ervaring.

## Doelgroepen

### Kwekers (growers)
- Loggen in om hun eigen data te bekijken
- Geen bewerkingsrechten, puur inzage
- Kunnen wereldwijd zitten (portal standaard in het Engels, ook NL kunnen selecteren)

### Admins (intern)
- Beheren kwekeraccounts en commercieaccounts (aanmaken, activeren, deactiveren)
- Toekomstig: data-import, factuurbeheer, etc.

### Commercie (intern)
- Beheren kwekeraccounts (aanmaken, activeren, deactiveren)
- Kunnen kijken in het dashboard

## Input
- Ik heb wat input in het mapje private input gezet
    - Salessheets als voorbeeld. Dit is de afrekening (factuur) met de kweker. Dit zijn de PDFs
        - Een salessheet is een afrekening van een aantal partijen. Ook worden daar kosten overheen gerekend. Die kosten zijn per partij bekend, en worden per salessheet geconsolideerd. De opgetelde kosten van de partijen die op de salessheet worden afgerekend, zijn dus als kosten op de salessheet zichtbaar    
    - Ook een dataset uit de huidige grower portal. Daar kun je dummy data van maken. Dit zijn de xls’jes in het private input mapje

## Functionele Eisen

- Authenticatie
    - Kwekers loggen in met email + wachtwoord
    - Role-based access: grower vs admin vs inkoper
    - Beveiligde routes (niet-ingelogde gebruikers worden doorgestuurd naar login)
    - Als admin en commercie zie je hetzelfde als kwekers, alleen kun je alle kwekers zien en moet je een individuele kweker kunnen selecteren
    - Als admin en zie een aantal extra admin beheeropties. Zoals kwekers aanmaken. Dan wordt er een activatielink naar de kweker gestuurd. Bij het aanmaken moet basis informatie van de kweker ingevuld kunnen worden (zie profielpagina kweker, hieronder ergens)
    
- Dashboard
    - Overzichtspagina voor de kweker. Laat z'n performance zien (bijv stelen vandaag, gister, YTD, vergelijking met vorig jaar
    - Mooi visueel (library gebruiken) met grafieken
- Verkopen
    - De kweker wil de verkopen van de afgelopen periode kunnen zien. En kunnen vergelijken met eerdere perioden. Vandaag/gisteren, YTD, etc
    - En de prijs die ervoor gemaakt is
    - Dit is dus een totaaltelling van de transacties die op partijen geweest zijn
    - Onderliggend is er denk ik een transactie-tabel waarin de detailtransacties te vinden zijn, die linken aan een partij
    - Idealiter wil je hier een mooie weergave hebben, van verkocht volume en de prijs die gemaakt is
    - Ook wil ik hier een referentie geven naar de marktprijs. Zodat je ziet dat we het beter dan de markt gedaan hebben. Die info heb ik nog niet - komt in de toekomst
- Aangevoerde partijen (overzicht)
    - Aangevoerde partijen met kenmerken en de datum
    - Ook status: Onderweg, wordt verkocht, verkocht
    - Ook kun je daar de afrekening zien. Daarbij hebben we worden diverse kosten in rekening gebracht
    - Er moet een linkje staan naar de salessheet die bij de partij hoort. Dan link je naar een document in de document sectie
    - Link naar kwaliteitsissues per partij (als die er zijn)
- Partij details
    - Doorklikken vanuit het overzicht naar details per partij
- Documenten
    - Dit is een document library.
    - Hier zie je onder meer de sales sheets staan
    - Ook kunnen hier andere items staan, zoals contracten, teeltplanningen, etc
    - Hier kunnen zowel kwekers als interne rollen bestanden uploaden

- Kweker/profiel
    - Per kweker wil ik een profielpagina met daarop o.m. NAW details.
    - Staat ook een inkoper (commercie) bij (verantwoordelijke van onze kant)
    - Ook moet hij de mogelijkheid hebben om een wijziging aan te vragen. Mag gewoon vrij tekstveld zijn dat naar inkoper gaat
    - Overzicht van de certificaten per kweker
- Kwaliteit
    - Overzicht van kwaliteitsissues.
    - Per partij





● Goed, ik heb nu een compleet beeld. Hier zijn mijn vragen, gegroepeerd per onderwerp:

  ---
  Data & Import

  1. Datadump1 bevat een "Your Ref. Number" -- is dat een kweker-referentie? Ik zie 195 unieke waarden, sommige lijken
  op interne codes ("GE 154", "98721"). Wat identificeert een kweker uniek in jullie systeem? Is er een
  kwekernummer/code?
-- Your ref number is de wijze waarop partijen en kosten per partij aan elkaar gelinkt zijn. Die data sluit nu waarschijnlijk niet aan. Ik heb een willekeurige set als voorbeeld bijgevoegd. Je kunt bij een initiele dataseed ervoor zorgen dat dit linkt, zodat we een dummy-set hebben om mee te werken

  2. De data in de Excel-bestanden -- wordt die straks automatisch gevoed vanuit een bronsysteem (ERP, boekhouding)? Of
  is het de bedoeling dat admins handmatig data importeren via CSV/Excel upload? Dit bepaalt of we een import-functie
  moeten bouwen of een API-koppeling.
-- Gaat in de toekomst met API binnenkomen
  3. Salessheets (PDF's) -- worden die handmatig geupload door admins, of wil je die ook automatisch genereren vanuit de
   data in het portal?
-- Ook die gaan via API binnenkomen


  Partijen & Transacties

  4. Lot-structuur: een lot heeft een lotnummer (bijv. 3881599), een productcode (PCFUP), aantal colli, steellengte,
  product, en S1/S2/S3 waarden. Wat zijn S1, S2 en S3 precies? Ik zie getallen als 80/23, 70/40/34 etc.
-- Lot nummer komt overeen met 'your ref number' (sluit nu dus niet aan, omdat dummy data). s1 s2 etc zijn kwaliteitskenmerken. Die horen in de onderliggende transactietabel
  5. Verkoopkanalen: ik zie "Direct sales", "VBA" (veiling), "VPL", en "Production". Klopt het dat dit de mogelijke
  verkoopkanalen zijn? Zijn er nog meer?
-- Voor nu zijn dat ze wel even. Ik zie dat ik in de dummy data maar weinig kenmerken/kanalen heb zitten. De salessheets geven daar een beter beeld van. Maak ook wat dummyregels met correcties enzo
  6. Kwaliteitscodes: ik zie codes als "110" (Few damaged flowers/bud/fruit), "154" (Few impure flowers), "120". Zijn
  dit gestandaardiseerde codes die we moeten tonen? Is er een vaste lijst?
-- Ja, maar die worden aangeleverd in de data. Hoeven we nu niet een lijst voor aan te leggen

  Kwekers & Rollen

  7. Commercie-rol: je noemt "inkoper" en "commercie" door elkaar. Is dat dezelfde rol? Dus iemand die verantwoordelijk
  is voor een set kwekers en hun data kan inzien?
-- Ja, dat is dezelfde rol
  8. Kweker-profiel: je noemt certificaten (GGN# zie ik op de salessheet). Welke certificaten zijn relevant? Zijn dat er
   meer dan alleen GlobalGAP/GGN?
-- MPS is er nog een. Kun je nu wat dummydata zetten, maar gaan we later met API vullen

  Scope & Prioriteit

  9. MVP-scope: wil je alles in een keer bouwen, of is er een prioriteit? Bijv. eerst dashboard + partijenoverzicht +
  salessheets, en later documenten-library en kwaliteitsmodule?
-- Nee, geen prios
  10. Demo data: zal ik op basis van de Excel-dumps dummy data genereren voor meerdere fictieve kwekers, zodat we een
  realistisch gevulde lokale omgeving hebben om mee te ontwikkelen?
-- Ja, graag. Doe maar een stuk of 20 kwekers ofzo


Duidelijk, dank voor de uitgebreide antwoorden. Ik heb nog een paar vervolgvragen voordat we aan de slag gaan:
Datamodel

  1. Kweker-identificatie: een kweker heeft NAW-gegevens, maar hoe worden ze in het bronsysteem geidentificeerd? Is er
  een kwekernummer/code (zoals "PCFUP", "COLXSHA" die ik op de salessheets zie)? Of is dat een productcode? Ik moet
  weten wat de unieke identifier van een kweker is die straks via de API binnenkomt.
  -- Ja, dat is de kwekersidentificatie. Die zie je niet in de dummydataset zitten, omdat die gedraaid is vanuit het perspectief van 1 kweker. Maar, die ligt er ook onder. 
  
  2. Relatie partij <-> salessheet: een salessheet (PDF) bundelt meerdere partijen van dezelfde kweker voor een bepaalde
   leveringsdatum. Klopt het dat de relatie is: 1 kweker -> N salessheets, 1 salessheet -> N partijen (lots), 1 partij
  -> N transacties?
  -- Ja, dat klopt precies
  3. Kosten: de kosten op de salessheet zijn een consolidatie van kosten per partij. Moeten we kosten op partijniveau
  opslaan (en dan optellen voor de salessheet), of alleen op salessheet-niveau?
  -- Nee, ook op partijniveau

  UX & Design

  4. Kweker-selector voor admin/commercie: als een admin of commercie-medewerker inlogt, zien ze dan eerst een lijst van
   alle kwekers waaruit ze er een kiezen, en zien ze daarna hetzelfde dashboard als die kweker? Of is er een apart
  admin-overzicht met totalen over alle kwekers?
  -- Dat laatste
  5. Grafiekbibliotheek: heb je een voorkeur? Recharts is populair bij Next.js projecten en werkt goed met shadcn/ui.
  Anders kan ik ook Tremor overwegen (heeft kant-en-klare dashboard-componenten bovenop Tailwind).
  -- Niet perse voorkeur. Recharts klinkt wel goed
  6. Branding: ik zie het Coloriginz logo. Wil je het portal in de Coloriginz huisstijl (kleuren, logo)? Zo ja, heb je
  een brandguide of zal ik het afleiden uit het logo (groen/rood accenten)?
  -- Dat logo dat je zag klopt niet, dat is het oude logo. Ik zet even een 'huisstijl' mapje neer in private input. Daar kun je kleurenpallet uit putten. Ook een logo bestandje, dat logo wordt gewoon z/w

  Lokale setup

  7. Lokale database: voor lokaal ontwikkelen, wil je een lokale PostgreSQL draaien (bijv. via Docker), of direct een
  Neon dev-database gebruiken? Aangezien je zei "eerst lokaal", ga ik uit van Docker.
  -- Ja, dat is prima. later naar neon