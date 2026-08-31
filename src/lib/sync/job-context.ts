/*
 * Wat een importroute over zijn eigen ronde kan weten.
 *
 * Een importroute krijgt alleen rijen en een `batchId`. Het venster en de
 * leverancier waarvoor die rijen zijn opgevraagd staan in de `SyncJob` erachter,
 * en dat is precies wat sommige beslissingen nodig hebben: de orders-route om te
 * bepalen wat er binnen dat venster ontbreekt en dus is ingetrokken, de
 * growers-route om te weten onder welke leverancier een nieuwe kweker hoort.
 *
 * Komt de POST niet van de portal-gestuurde sync — een oude DAX-flow of een
 * reparatiescript, allebei zonder `batchId` — dan is er geen job en geeft dit
 * null terug. Elke aanroeper moet dat geval expliciet afhandelen: geen job
 * betekent minder weten, en minder weten hoort tot voorzichtiger gedrag te
 * leiden, niet tot een aanname.
 */
import { prisma } from "@/lib/db";

export type JobContext = {
  windowFrom: Date;
  windowTo: Date;
  supplierFabricId: number | null;
};

/**
 * De sync-job achter deze batch, of null.
 *
 * Er wordt bewust niet op status gefilterd. De job staat op `dispatched` zolang
 * de import draait, maar een herstart of een handmatige reset kan die status
 * verzetten, en dan zou het venster stilzwijgend verdwijnen en de route
 * terugvallen op ouder, voorzichtiger gedrag zonder dat iemand het merkt.
 */
export async function findJobForBatch(batchId: string | null): Promise<JobContext | null> {
  if (!batchId) return null;
  return prisma.syncJob.findFirst({
    where: { importBatchId: batchId },
    select: { windowFrom: true, windowTo: true, supplierFabricId: true },
  });
}

/**
 * De portal-leverancier achter een `rel_id`, los van wat de payload droeg.
 *
 * Apart opgezocht en niet uit de rijen afgeleid: bij een backfill voor één
 * leverancier kan de payload rijen bevatten die allemaal worden overgeslagen, en
 * dan is er niets om de leverancier uit af te leiden terwijl de job hem wel kent.
 */
export async function resolveScopedSupplierId(
  supplierFabricId: number | null
): Promise<string | null> {
  if (supplierFabricId === null) return null;
  const supplier = await prisma.supplier.findFirst({
    where: { fabricId: supplierFabricId },
    select: { id: true },
  });
  return supplier?.id ?? null;
}
