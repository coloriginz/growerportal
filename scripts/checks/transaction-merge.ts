import { mergeTransactions, channelLabel, type MergeableTransaction } from "../../src/lib/transaction-merge";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

let teller = 0;
function tx(o: Partial<MergeableTransaction> & { stems: number; amount: string }): MergeableTransaction {
  teller += 1;
  return {
    id: `t${teller}`,
    fabricOrdregId: 1,
    date: "2025-05-08T00:00:00.000Z",
    salesType: "Veilen",
    pricePerStem: "0.186",
    bronFeitExtra: "origineel",
    correctionReasonId: null,
    ...o,
  };
}

// ─── de gesplitste orderregel ──────────────────────────────

/*
 * Partij 3645448 (PCXRONEN, levering 4324147), 08-05-2025: ordreg 15674817 komt
 * als 600 + 2.400 binnen omdat één orderregel in delen wordt geleverd. De
 * afrekening drukt 3.000 voor EUR 558,00. Een eerdere versie nam met `.find()`
 * alleen de eerste originele rij en toonde 2.400 voor EUR 446,40.
 */
{
  const regels = mergeTransactions([
    tx({ fabricOrdregId: 15674817, stems: 600, amount: "111.60" }),
    tx({ fabricOrdregId: 15674817, stems: 2400, amount: "446.40" }),
  ]);
  check("een gesplitste orderregel wordt opgeteld, niet gehalveerd", regels.length === 1 && regels[0].stems === 3000);
  check("en het bedrag telt mee", regels.length === 1 && Math.abs(regels[0].amount - 558) < 0.0001,
        regels.length === 1 ? String(regels[0].amount) : `${regels.length} regels`);
  check("de prijs blijft die van de afrekening", regels.length === 1 && Math.abs(regels[0].pricePerStem - 0.186) < 0.0001);
}

{
  // Dezelfde splitsing maar met uiteenlopende prijzen: dan hoort er een gewogen
  // gemiddelde te staan, niet de prijs van de eerste rij.
  const regels = mergeTransactions([
    tx({ fabricOrdregId: 7, stems: 1000, amount: "100.00", pricePerStem: "0.10" }),
    tx({ fabricOrdregId: 7, stems: 1000, amount: "300.00", pricePerStem: "0.30" }),
  ]);
  check("bij verschillende prijzen weegt de prijs mee",
        regels.length === 1 && regels[0].stems === 2000 && Math.abs(regels[0].pricePerStem - 0.2) < 0.0001,
        regels.length === 1 ? String(regels[0].pricePerStem) : `${regels.length} regels`);
}

{
  const regels = mergeTransactions([
    tx({ fabricOrdregId: 8, stems: 100, amount: "10.00" }),
    tx({ fabricOrdregId: 8, stems: 200, amount: "20.00" }),
    tx({ fabricOrdregId: 8, stems: 300, amount: "30.00" }),
  ]);
  check("ook drie delen tellen volledig mee", regels.length === 1 && regels[0].stems === 600);
}

// ─── verkoop en correctie blijven gescheiden ───────────────

{
  const regels = mergeTransactions([
    tx({ fabricOrdregId: 9, stems: 2680, amount: "948.80", pricePerStem: "0.354" }),
    tx({ fabricOrdregId: 9, stems: 0, amount: "-154.00", bronFeitExtra: "correcties", correctionReasonId: 12 }),
  ]);
  const verkoop = regels.find((r) => !r.hasCorrection);
  const correctie = regels.find((r) => r.hasCorrection);
  check("verkoop en correctie blijven twee regels", regels.length === 2);
  check("de verkoopprijs blijft die van de sales sheet",
        !!verkoop && Math.abs(verkoop.pricePerStem - 0.354) < 0.0001);
  check("de correctie draagt haar eigen bedrag", !!correctie && Math.abs(correctie.amount + 154) < 0.0001);
  check("en houdt haar reden vast", correctie?.correctionReasonId === 12);
}

{
  const regels = mergeTransactions([
    tx({ fabricOrdregId: 10, stems: 500, amount: "50.00" }),
    tx({ fabricOrdregId: 10, stems: 0, amount: "0", bronFeitExtra: "prullenbak-factcor" }),
  ]);
  check("een correctie die niets verandert wordt niet getoond", regels.length === 1 && !regels[0].hasCorrection);
}

{
  const regels = mergeTransactions([
    tx({ fabricOrdregId: 11, stems: 0, amount: "0", bronFeitExtra: "prullenbak-factcor" }),
  ]);
  check("een groep zonder originele regel verdwijnt niet", regels.length === 1);
}

// ─── de tweede stap: dag en kanaal ─────────────────────────

check("Persoonlijk, VMP en Aurora heten Direct Sales",
      ["Persoonlijk", "VMP", "Aurora"].every((t) => channelLabel(t) === "Direct Sales"));
check("Veilen houdt zijn eigen naam", channelLabel("Veilen") === "Veilen");

{
  const regels = mergeTransactions([
    tx({ fabricOrdregId: 20, stems: 150, amount: "30.00", salesType: "VMP" }),
    tx({ fabricOrdregId: 21, stems: 450, amount: "87.75", salesType: "Aurora" }),
    tx({ fabricOrdregId: 22, stems: 3000, amount: "558.00", salesType: "Veilen" }),
  ]);
  const direct = regels.find((r) => r.salesType === "Direct Sales");
  const veiling = regels.find((r) => r.salesType === "Veilen");
  check("VMP en Aurora van één dag worden één Direct Sales-regel",
        !!direct && direct.stems === 600 && Math.abs(direct.amount - 117.75) < 0.0001);
  check("de veiling blijft daarnaast staan", !!veiling && veiling.stems === 3000);
  check("twee kanalen leveren twee regels", regels.length === 2);
}

{
  const regels = mergeTransactions([
    tx({ fabricOrdregId: 30, stems: 100, amount: "20.00", date: "2025-05-07T00:00:00.000Z" }),
    tx({ fabricOrdregId: 31, stems: 100, amount: "20.00", date: "2025-05-08T00:00:00.000Z" }),
  ]);
  check("twee dagen blijven twee regels", regels.length === 2);
  check("en staan op datum gesorteerd", regels[0].date < regels[1].date);
}

{
  const regels = mergeTransactions([tx({ fabricOrdregId: null, stems: 700, amount: "70.00" })]);
  check("een regel zonder ordreg_id gaat ongemoeid door", regels.length === 1 && regels[0].stems === 700);
}

if (failures > 0) {
  console.error(`\n${failures} controle(s) mislukt`);
  process.exit(1);
}
console.log("\nAlle controles geslaagd");
