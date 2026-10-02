"use server";

import { resolveStoreScope } from "@/lib/auth/access";
import * as queries from "@/lib/vencimentos/queries";

export type {
  RenewalRow,
  UpcomingReceiptRow,
} from "@/lib/vencimentos/queries";

/*
 * Server actions de vencimentos. O storeId pedido pelo browser não é
 * confiável: resolveStoreScope limita não-admins à sua loja.
 */

export async function getUpcomingRenewals({
  storeId,
}: {
  storeId: string | null;
}) {
  return queries.getUpcomingRenewals({
    storeId: await resolveStoreScope(storeId),
  });
}

export async function getUpcomingReceipts({
  storeId,
}: {
  storeId: string | null;
}) {
  return queries.getUpcomingReceipts({
    storeId: await resolveStoreScope(storeId),
  });
}

export async function getOverdueReceiptsCount({
  storeId,
}: {
  storeId: string | null;
}) {
  return queries.getOverdueReceiptsCount({
    storeId: await resolveStoreScope(storeId),
  });
}
