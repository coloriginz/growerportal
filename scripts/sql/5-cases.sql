-- Alle onderzoeksvragen in één batch, zodat het hotspot-venster kort blijft.
-- Draait tegen wh_transform; lh_landing wordt via three-part naming benaderd.

-- ============ 1. De bron: één verdeelregel per case ============
SELECT 'bron' AS setnaam, ordreg_id, part_id, verd_id,
       CAST(aantalst AS float) AS aantalst, CAST(inkwaarde AS float) AS inkwaarde,
       aanmaakdatumtijd
FROM   lh_landing.kbtpro.verd
WHERE  ordreg_id IN (14721748, 14901351, 16986489, 14817319, 16687614)
ORDER BY ordreg_id;

-- ============ 2. Samenvatting per case ============
SELECT ordreg_id,
       COUNT(*)                                    AS rijen,
       COUNT(DISTINCT part_id)                     AS partijen,
       COUNT(DISTINCT verd_id)                     AS verdeelregels,
       MIN(order_type)                             AS order_type,
       COUNT(DISTINCT verwerk_id_productie)        AS n_verwerk_productie,
       SUM(CAST(productie_input_aantal AS float))  AS som_productie_input,
       SUM(CAST(vor_aantal AS float))              AS som_aantal
FROM   intermediate.int_order_totaal
WHERE  ordreg_id IN (14721748, 14901351, 16986489, 14817319, 16687614)
GROUP BY ordreg_id
ORDER BY ordreg_id;

-- ============ 3. Toets op de productieorder-hypothese ============
SELECT CASE WHEN verwerk_id_productie IS NULL THEN 'geen productie' ELSE 'productieorder' END AS soort,
       COUNT(*) AS rijen,
       COUNT(DISTINCT CONCAT(CAST(ordreg_id AS varchar(20)),'|',CAST(part_id AS varchar(20)))) AS combinaties,
       CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CONCAT(CAST(ordreg_id AS varchar(20)),'|',CAST(part_id AS varchar(20)))), 0) AS decimal(10,2)) AS rijen_per_combinatie
FROM   intermediate.int_order_totaal
WHERE  ordreg_id IS NOT NULL AND part_id IS NOT NULL
GROUP BY CASE WHEN verwerk_id_productie IS NULL THEN 'geen productie' ELSE 'productieorder' END;

-- ============ 4. Omvang van het verschijnsel ============
SELECT CASE WHEN n = 1 THEN '1 regel' WHEN n <= 5 THEN '2-5' WHEN n <= 20 THEN '6-20'
            WHEN n <= 50 THEN '21-50' ELSE '50+' END AS aantal_regels,
       COUNT(*) AS combinaties,
       SUM(n)   AS totaal_rijen
FROM  (SELECT ordreg_id, part_id, COUNT(*) AS n
       FROM   intermediate.int_order_totaal
       WHERE  ordreg_id IS NOT NULL AND part_id IS NOT NULL
       GROUP BY ordreg_id, part_id) x
GROUP BY CASE WHEN n = 1 THEN '1 regel' WHEN n <= 5 THEN '2-5' WHEN n <= 20 THEN '6-20'
              WHEN n <= 50 THEN '21-50' ELSE '50+' END
ORDER BY 1;

-- ============ 5. Volledige breedte: transformatielaag ============
SELECT * FROM intermediate.int_order_totaal
WHERE  ordreg_id IN (14721748, 14901351, 16986489, 14817319, 16687614)
ORDER BY ordreg_id;

-- ============ 6. Volledige breedte: gold layer ============
SELECT * FROM marts.fct_orders
WHERE  ordreg_id IN (14721748, 14901351, 16986489, 14817319, 16687614)
ORDER BY ordreg_id;
