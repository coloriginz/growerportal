# Reparatie kostenregels

Uitgevoerd: 2026-08-25 22:41
Modus: toegepast
Doelportal: http://localhost:3000

| leverancier | kwartalen | kostenregels | bijgesteld | zonder costCode voor | na |
|---|---|---|---|---|---|
| COLBFL | 7 | 3398 | 0,00 | 0 | 0 |
| COLCICE | 7 | 3299 | 0,00 | 0 | 0 |
| COLFLCEU | 7 | 1294 | 0,00 | 0 | 0 |
| COLLATZC | 3 | 565 | 0,00 | 0 | 0 |
| COLOZFL | 7 | 3697 | 0,00 | 0 | 0 |
| COLPLFRE | 2 | 227 | 0,00 | 0 | 0 |
| COLSEMPC | 2 | 743 | 0,00 | 0 | 0 |
| COLXAFRI | 6 | 1756 | 0,00 | 4 | 4 |
| COLXGREE | 4 | 1320 | 0,00 | 0 | 0 |
| COLXIMA | 1 | 40 | 0,00 | 0 | 0 |
| COLXLNFB | 6 | 512 | 0,00 | 0 | 0 |
| COLXLNFW | 7 | 2505 | 0,00 | 0 | 0 |
| COLXROOD | 2 | 240 | 0,00 | 0 | 0 |
| COLXSHA | 6 | 567 | 0,00 | 0 | 0 |
| COLXTOG2 | 3 | 324 | 0,00 | 0 | 0 |
| COLZFLXC | 5 | 3870 | 0,00 | 0 | 0 |
| MDHAGE | 5 | 958 | 0,00 | 0 | 0 |
| MDHAGED | 2 | 212 | 0,00 | 0 | 0 |
| MDTT | 5 | 376 | 0,00 | 0 | 0 |
| MPBENNE | 2 | 76 | 0,00 | 0 | 0 |
| MPFLAN | 6 | 2575 | 0,00 | 0 | 0 |
| MPFLND | 4 | 160 | 0,00 | 0 | 0 |
| MPGROOTP | 2 | 310 | 0,00 | 0 | 0 |
| MPJCKARA | 2 | 405 | 0,00 | 0 | 0 |
| MPJCKARD | 3 | 78 | 0,00 | 0 | 0 |
| MPJONGEL | 2 | 1062 | 0,00 | 0 | 0 |
| MPJSK | 2 | 560 | 0,00 | 0 | 0 |
| MPOARAV | 4 | 144 | 0,00 | 0 | 0 |
| MPOBOER | 1 | 51 | 0,00 | 0 | 0 |
| MPOBOKA | 6 | 271 | 0,00 | 0 | 0 |
| MPOBRABO | 2 | 538 | 0,00 | 0 | 0 |
| MPOCIVIT | 4 | 498 | 0,00 | 0 | 0 |
| MPODELTA | 2 | 920 | 0,00 | 0 | 0 |
| MPOHER | 2 | 88 | 0,00 | 0 | 0 |
| MPOIACOM | 4 | 101 | 0,00 | 0 | 0 |
| MPOKNOL | 2 | 280 | 0,00 | 0 | 0 |
| MPOMARCO | 2 | 30 | 0,00 | 0 | 0 |
| MPONATHE | 5 | 662 | 0,00 | 0 | 0 |
| MPONEEF | 2 | 585 | 0,00 | 0 | 0 |
| MPOPEONI | 2 | 912 | 0,00 | 0 | 0 |
| MPORVL | 4 | 818 | 0,00 | 0 | 0 |
| MPOVELD | 2 | 315 | 0,00 | 0 | 0 |
| MPOXEIJC | 6 | 216 | 0,00 | 0 | 0 |
| MPPAEONN | 4 | 1781 | 0,00 | 0 | 0 |
| MPVALENT | 2 | 189 | 0,00 | 0 | 0 |
| MPXMOLFR | 3 | 210 | 0,00 | 0 | 0 |
| PCFFARCO | 7 | 2139 | -2.772,23 | 220 | 0 |
| PCFRUT | 5 | 1137 | 0,00 | 0 | 0 |
| PCFUP | 7 | 1907 | 0,00 | 0 | 0 |
| PCFUSA | 5 | 2448 | 0,00 | 0 | 0 |
| PCRUICON | 5 | 1 | 0,00 | 0 | 0 |
| PCXBAR | 5 | 966 | 0,00 | 0 | 0 |
| PCXELHAI | 7 | 494 | 0,00 | 0 | 0 |
| PCXGAF | 6 | 834 | 0,00 | 0 | 0 |
| PCXOMRI | 7 | 2164 | 0,00 | 0 | 0 |
| PCXRONEN | 7 | 770 | 0,00 | 0 | 0 |
| SCXGOLFB | 7 | 971 | -3.664,00 | 75 | 0 |
| SCXGOLFW | 7 | 1733 | -5.336,84 | 60 | 0 |
| **totaal** | 244 | 55302 | **-11.773,07** | 359 | 4 |

## Lezen

"Bijgesteld" is het verschil in de som van de kostenbedragen, niet een fout die is
hersteld: het warehouse herziet zowel omhoog als omlaag. `SalesSheet.totalCosts` en
`netResult` zijn door de import meegerekend.
