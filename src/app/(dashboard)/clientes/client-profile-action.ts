"use server";

import { assertClientAccess } from "@/lib/auth/access";
import {
  loadClientProfile,
  type ClientProfile,
} from "@/lib/clients/load-client-profile";

export type {
  ClientProfile,
  ClientProviderData,
} from "@/lib/clients/load-client-profile";

export async function getClientProfile(
  clientId: string,
): Promise<ClientProfile> {
  await assertClientAccess([clientId]);

  return loadClientProfile(clientId);
}
