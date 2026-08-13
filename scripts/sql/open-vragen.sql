-- Beantwoordt de openstaande vragen uit docs/kbt-extractie-verzoek.md
-- Draaien tegen lh_landing (FABRIC_DB=lh_landing)

-- ===== V1. Is parthdr.rel_id de leverancier en part.rel_id de kweker? =====
SELECT rl.levok  AS parthdr_levok,  rl.kwekerok AS parthdr_kwekerok,
       rk.levok  AS part_levok,     rk.kwekerok AS part_kwekerok,
       CASE WHEN ph.rel_id = p.rel_id THEN 'zelfde relatie' ELSE 'verschillend' END AS relatie,
       COUNT(*) AS partijen
FROM   kbtpro.part p
JOIN   kbtpro.parthdr ph ON ph.parthdr_id = p.parthdr_id
LEFT JOIN kbtpro.rel rl ON rl.rel_id = ph.rel_id
LEFT JOIN kbtpro.rel rk ON rk.rel_id = p.rel_id
GROUP BY rl.levok, rl.kwekerok, rk.levok, rk.kwekerok,
         CASE WHEN ph.rel_id = p.rel_id THEN 'zelfde relatie' ELSE 'verschillend' END
ORDER BY COUNT(*) DESC;

-- ===== V3. Colli versus aantal per eenheid =====
-- aantal x ape zou het totaal aantal stelen moeten geven; toetsen aan de verdeling
SELECT TOP 12 p.part_id, p.aantal, p.ape,
       CAST(p.aantal AS float) * CAST(p.ape AS float) AS aantal_x_ape,
       SUM(CAST(v.aantalst AS float))                 AS verdeeld_totaal
FROM   kbtpro.part p
JOIN   kbtpro.verd v ON v.part_id = p.part_id
WHERE  p.aantal > 0 AND p.ape > 0
GROUP BY p.part_id, p.aantal, p.ape
ORDER BY p.part_id DESC;

-- ===== V4. Artikelgroep-dekking =====
SELECT COUNT(*)                                          AS artikelen,
       SUM(CASE WHEN agrp_id IS NULL THEN 1 ELSE 0 END)  AS zonder_agrp,
       COUNT(DISTINCT agrp_id)                           AS unieke_groepen
FROM   kbtpro.art;

-- ===== V6. Correctie in colli =====
SELECT COUNT(*)                                                AS correcties,
       SUM(CASE WHEN coraantalst IS NULL THEN 1 ELSE 0 END)    AS coraantalst_leeg,
       SUM(CASE WHEN ape         IS NULL THEN 1 ELSE 0 END)    AS ape_leeg,
       SUM(CASE WHEN fust_id     IS NULL THEN 1 ELSE 0 END)    AS fust_leeg,
       SUM(CASE WHEN reden_id    IS NULL THEN 1 ELSE 0 END)    AS reden_leeg,
       COUNT(DISTINCT ape)                                     AS unieke_ape
FROM   kbtpro.partcor;

-- ===== V6b. Voorbeeldcorrecties =====
SELECT TOP 12 partcor_id, part_id, reden_id, coraantalst, ape, fust_id, cordatum
FROM   kbtpro.partcor
WHERE  coraantalst IS NOT NULL
ORDER BY cordatum DESC;

-- ===== V7. Accountmanager op de relatie =====
SELECT COUNT(*)                                              AS leveranciers,
       SUM(CASE WHEN verkoper_id IS NULL THEN 1 ELSE 0 END)  AS zonder_verkoper,
       COUNT(DISTINCT verkoper_id)                           AS unieke_verkopers
FROM   kbtpro.rel
WHERE  levok = 1;

-- ===== V7b. Verkoper uitgeschreven =====
SELECT TOP 15 m.mede_id, m.kode, m.oms, COUNT(*) AS relaties
FROM   kbtpro.rel r
JOIN   kbtpro.mede m ON m.mede_id = r.verkoper_id
WHERE  r.levok = 1
GROUP BY m.mede_id, m.kode, m.oms
ORDER BY COUNT(*) DESC;

-- ===== V8. Kwaliteit: wat zit er in veilkwal =====
SELECT TOP 25 * FROM kbtpro.veilkwal ORDER BY veilkwal_id;
