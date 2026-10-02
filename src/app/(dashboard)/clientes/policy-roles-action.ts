"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCachedPartners,
  getCachedProfiles,
  invalidateReference,
} from "@/lib/cache/reference-data";

/*
 * Intervenientes de uma apólice:
 *   angariador → acquirer_user_id   (qualquer utilizador)
 *   gestor     → issued_by_user_id  (obrigatoriamente quem emitiu)
 *   comercial  → commercial_user_id (qualquer utilizador)
 *   origem     → partner_id (parceiro externo) OU origin_user_id
 *                (funcionário). Nunca os dois.
 *
 * O mesmo utilizador pode ter todos os papéis ao mesmo tempo.
 *
 * Permissões:
 * - OWNER/ADMIN alteram tudo.
 * - Restantes, só em apólices da sua loja (ou ainda sem loja):
 *   preenchem papéis vazios ou que são deles próprios — não
 *   sobrepõem o que já está atribuído a outra pessoa.
 * - Gestor: cada um só se pode marcar a si próprio ("Fui eu que
 *   emiti"); só OWNER/ADMIN corrigem para outra pessoa.
 */

export type RolePerson = { id: string; full_name: string };

export type PartnerOption = {
  id: string;
  name: string;
  partner_type: string | null;
};

export type PolicyRoles = {
  acquirer: RolePerson | null;
  issuer: RolePerson | null;
  commercial: RolePerson | null;
  origin:
    | { type: "partner"; partner: PartnerOption }
    | { type: "user"; user: RolePerson }
    | null;
};

export type PolicyRolesData = {
  roles: PolicyRoles;
  store: { id: string; name: string } | null;
  profiles: RolePerson[];
  partners: PartnerOption[];
  currentUserId: string;
  isAdmin: boolean;
  canEdit: boolean;
};

type PolicyRoleRow = {
  id: string;
  issuing_store_id: string | null;
  acquirer_user_id: string | null;
  issued_by_user_id: string | null;
  commercial_user_id: string | null;
  partner_id: string | null;
  origin_user_id: string | null;
};

async function loadContext(policyId: string) {
  const profile = await getCurrentProfile();

  if (!profile) throw new Error("Não autenticado.");
  if (!policyId) throw new Error("Apólice inválida.");

  const admin = createAdminClient();

  const { data: policy, error } = await admin
    .from("policies")
    .select(
      "id, issuing_store_id, acquirer_user_id, issued_by_user_id, commercial_user_id, partner_id, origin_user_id",
    )
    .eq("id", policyId)
    .maybeSingle<PolicyRoleRow>();

  if (error) throw new Error(`Erro ao carregar apólice: ${error.message}`);
  if (!policy) throw new Error("Apólice não encontrada.");

  const isAdmin = profile.role === "OWNER" || profile.role === "ADMIN";
  const profileStoreId = profile.store?.id ?? null;

  const canEdit =
    isAdmin ||
    (profileStoreId !== null &&
      (!policy.issuing_store_id ||
        policy.issuing_store_id === profileStoreId));

  return { admin, profile, policy, isAdmin, canEdit, profileStoreId };
}

/*
 * Intervenientes de várias apólices de uma vez (painel do cliente):
 * utilizadores, parceiros e lojas carregados uma só vez.
 */
export async function getPoliciesRoles(
  policyIds: string[],
): Promise<Record<string, PolicyRolesData>> {
  const profile = await getCurrentProfile();

  if (!profile) throw new Error("Não autenticado.");

  const ids = Array.from(new Set(policyIds.filter(Boolean)));

  if (ids.length === 0) return {};

  const admin = createAdminClient();

  const { data: policiesData, error: policiesError } = await admin
    .from("policies")
    .select(
      "id, issuing_store_id, acquirer_user_id, issued_by_user_id, commercial_user_id, partner_id, origin_user_id",
    )
    .in("id", ids);

  if (policiesError) {
    throw new Error(`Erro ao carregar apólices: ${policiesError.message}`);
  }

  const policies = (policiesData ?? []) as PolicyRoleRow[];

  // Acesso por loja (mesma regra da carteira): não-admins só veem
  // apólices da sua loja ou ainda sem loja.
  if (profile.role !== "OWNER" && profile.role !== "ADMIN") {
    const ownStore = profile.store?.id ?? null;

    const forbidden = policies.some(
      (p) => p.issuing_store_id !== null && p.issuing_store_id !== ownStore,
    );

    if (forbidden) {
      throw new Error("Não tens acesso a estas apólices.");
    }
  }

  const storeIds = Array.from(
    new Set(policies.map((p) => p.issuing_store_id).filter(Boolean)),
  ) as string[];

  const [allProfiles, allPartners, storesResult] = await Promise.all([
    getCachedProfiles(),
    getCachedPartners(),
    storeIds.length > 0
      ? admin.from("stores").select("id, name").in("id", storeIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const stores = new Map(
    (storesResult.data ?? []).map((s) => [s.id, s]),
  );

  const isAdmin = profile.role === "OWNER" || profile.role === "ADMIN";
  const profileStoreId = profile.store?.id ?? null;

  const person = (id: string | null): RolePerson | null => {
    if (!id) return null;
    const found = allProfiles.find((p) => p.id === id);
    return found ? { id: found.id, full_name: found.full_name } : null;
  };

  // Nas listas só aparecem ativos (o atual continua visível no papel).
  const activeProfiles = allProfiles
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, full_name: p.full_name }));

  const activePartners = allPartners
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name, partner_type: p.partner_type }));

  const result: Record<string, PolicyRolesData> = {};

  for (const policy of policies) {
    const partner = policy.partner_id
      ? allPartners.find((p) => p.id === policy.partner_id) ?? null
      : null;

    const originUser = person(policy.origin_user_id);

    result[policy.id] = {
      roles: {
        acquirer: person(policy.acquirer_user_id),
        issuer: person(policy.issued_by_user_id),
        commercial: person(policy.commercial_user_id),
        origin: partner
          ? {
              type: "partner",
              partner: {
                id: partner.id,
                name: partner.name,
                partner_type: partner.partner_type,
              },
            }
          : originUser
            ? { type: "user", user: originUser }
            : null,
      },
      store: policy.issuing_store_id
        ? stores.get(policy.issuing_store_id) ?? null
        : null,
      profiles: activeProfiles,
      partners: activePartners,
      currentUserId: profile.id,
      isAdmin,
      canEdit:
        isAdmin ||
        (profileStoreId !== null &&
          (!policy.issuing_store_id ||
            policy.issuing_store_id === profileStoreId)),
    };
  }

  return result;
}

export async function getPolicyRoles(
  policyId: string,
): Promise<PolicyRolesData> {
  if (!policyId) throw new Error("Apólice inválida.");

  const roles = (await getPoliciesRoles([policyId]))[policyId];

  if (!roles) throw new Error("Apólice não encontrada.");

  return roles;
}

export type PolicyRolesPatch = {
  acquirerUserId?: string | null;
  commercialUserId?: string | null;
  issuedByUserId?: string | null;
  origin?:
    | { type: "partner"; id: string }
    | { type: "user"; id: string }
    | null;
};

export async function updatePolicyRoles(
  policyId: string,
  patch: PolicyRolesPatch,
): Promise<PolicyRolesData> {
  const { admin, profile, policy, isAdmin, canEdit } =
    await loadContext(policyId);

  if (!canEdit) {
    throw new Error("Não tens permissão para alterar esta apólice.");
  }

  // Não-admins não sobrepõem papéis atribuídos a outra pessoa.
  function assertCanReplace(currentId: string | null, label: string) {
    if (!isAdmin && currentId && currentId !== profile.id) {
      throw new Error(
        `${label} já está atribuído(a) a outra pessoa. Pede a um administrador para alterar.`,
      );
    }
  }

  async function assertActiveProfile(id: string) {
    const { data } = await admin
      .from("profiles")
      .select("id, active")
      .eq("id", id)
      .maybeSingle();

    if (!data?.active) {
      throw new Error("Utilizador inválido ou desativado.");
    }
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.acquirerUserId !== undefined) {
    assertCanReplace(policy.acquirer_user_id, "O angariador");
    if (patch.acquirerUserId) await assertActiveProfile(patch.acquirerUserId);
    update.acquirer_user_id = patch.acquirerUserId;
  }

  if (patch.commercialUserId !== undefined) {
    assertCanReplace(policy.commercial_user_id, "O comercial");

    if (patch.commercialUserId) {
      await assertActiveProfile(patch.commercialUserId);

      // Tal como no "Associar-me": apólice sem loja (caso típico da
      // Zurich) fica com a loja do comercial.
      if (!policy.issuing_store_id) {
        const { data: commercial } = await admin
          .from("profiles")
          .select("store_id")
          .eq("id", patch.commercialUserId)
          .maybeSingle();

        if (commercial?.store_id) {
          update.issuing_store_id = commercial.store_id;
        }
      }
    }

    update.commercial_user_id = patch.commercialUserId;
  }

  if (patch.issuedByUserId !== undefined) {
    const target = patch.issuedByUserId;

    if (!isAdmin) {
      // Só "Fui eu que emiti" (ou desfazer o próprio).
      const claimingSelf = target === profile.id && !policy.issued_by_user_id;
      const releasingSelf =
        target === null && policy.issued_by_user_id === profile.id;

      if (!claimingSelf && !releasingSelf) {
        throw new Error(
          "O gestor é quem emitiu a apólice: só te podes marcar a ti próprio.",
        );
      }
    }

    if (target) await assertActiveProfile(target);
    update.issued_by_user_id = target;
  }

  if (patch.origin !== undefined) {
    // Origem num parceiro conta como "já atribuída" (a outra pessoa)
    // para efeitos de não-admins a sobreporem.
    assertCanReplace(
      policy.origin_user_id ?? (policy.partner_id ? "partner" : null),
      "A origem",
    );

    if (patch.origin === null) {
      update.partner_id = null;
      update.origin_user_id = null;
    } else if (patch.origin.type === "partner") {
      const { data: partner } = await admin
        .from("partners")
        .select("id, active")
        .eq("id", patch.origin.id)
        .maybeSingle();

      if (!partner?.active) {
        throw new Error("Parceiro inválido ou desativado.");
      }

      update.partner_id = partner.id;
      update.origin_user_id = null;
    } else {
      await assertActiveProfile(patch.origin.id);
      update.origin_user_id = patch.origin.id;
      update.partner_id = null;
    }
  }

  const { error } = await admin
    .from("policies")
    .update(update)
    .eq("id", policyId);

  if (error) {
    throw new Error(`Erro ao guardar intervenientes: ${error.message}`);
  }

  return getPolicyRoles(policyId);
}

/*
 * Criação rápida de parceiro a partir da apólice. A gestão completa
 * está em Configurações → Parceiros.
 */
export async function quickCreatePartner(input: {
  name: string;
  partnerType: string;
}): Promise<PartnerOption> {
  const profile = await getCurrentProfile();

  if (!profile) throw new Error("Não autenticado.");

  const name = input.name.trim();

  if (!name) throw new Error("O nome do parceiro é obrigatório.");

  if (!["PARTNER", "COMPANY", "PERSON"].includes(input.partnerType)) {
    throw new Error("Tipo de parceiro inválido.");
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("partners")
    .insert({ name, partner_type: input.partnerType, active: true })
    .select("id, name, partner_type")
    .single();

  if (error) {
    throw new Error(`Erro ao criar parceiro: ${error.message}`);
  }

  invalidateReference("partners");

  return data;
}
