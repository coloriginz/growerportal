"use client";

import { useLanguage } from "@/components/providers/language-provider";

interface Props {
  /** De naam van de ingelogde gebruiker (`session.user.name`). */
  userName: string;
  /**
   * De leverancier namens wie deze gebruiker inlogt. Alleen gevuld voor
   * supplier-accounts: een medewerker logt namens niemand in, en welke
   * leverancier hij op dit moment bekijkt staat al in de selector.
   */
  supplierName?: string | null;
}

/**
 * Begroeting bovenaan het dashboard, boven de paginatitel. Bewust een band met
 * een lijn eronder in plaats van een kaart: het hoort bij de pagina, niet bij
 * de cijfers.
 */
export function DashboardWelcome({ userName, supplierName }: Props) {
  const { t } = useLanguage();

  return (
    <div className="border-border mb-8 border-b pb-5">
      <h2 className="text-xl font-semibold tracking-tight">
        {t("dashboard.welcome")}, {userName}
      </h2>
      {supplierName && (
        <p className="text-muted-foreground mt-1 text-sm">{supplierName}</p>
      )}
    </div>
  );
}
