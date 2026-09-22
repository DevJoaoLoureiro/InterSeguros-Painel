import { createAdminClient } from "@/lib/supabase/admin";
import {
  getZurichAccounts,
  obterCoberturasPorApolice,
  obterObjetosPorNrApolice,
  type ZurichAccount,
} from "@/lib/insurance/providers/zurich/client";
import {
  maskIdentifier,
  sanitizeZurichText,
} from "@/lib/insurance/providers/zurich/log-safety";
import {
  buildZurichEnrichmentPatch,
  hasZurichCoverageContent,
  hasZurichObjectContent,
} from "@/lib/insurance/providers/zurich/risk-enrichment";

/**
 * Atualiza os dados de risco (objetos + coberturas) de UMA apólice
 * Zurich a partir da consulta individual.
 *
 *   GET ?apolice=NUMERO           -> PRÉ-VISUALIZAÇÃO: lê da Zurich e da BD,
 *                                    NÃO escreve nada.
 *   GET ?apolice=NUMERO&apply=1   -> grava em policies.provider_metadata.
 *
 * O que grava nunca substitui metadata mais rico por mais pobre: as
 * listas juntam-se por chave ao que já existe (ver
 * buildZurichEnrichmentPatch) e as chaves que não vêm ficam como estão.
 * Não devolve o metadata completo (tem o IBAN): só um resumo.
 */

function errorText(error: unknown): string {
  return sanitizeZurichText(
    error instanceof Error ? error.message : String(error),
  );
}

/** Conta Zurich da loja da apólice (senão a conta default do client). */
function pickAccount(metadata: Record<string, unknown>): ZurichAccount | undefined {
  const storeCode =
    typeof metadata.storeExternalCode === "string"
      ? metadata.storeExternalCode
      : null;

  if (!storeCode) {
    return undefined;
  }

  try {
    return getZurichAccounts().find(
      (account) => account.storeExternalCode === storeCode,
    );
  } catch {
    return undefined;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const apolice = searchParams.get("apolice");
  const apply = searchParams.get("apply") === "1";

  if (!apolice) {
    return Response.json(
      {
        success: false,
        error: "Falta ?apolice=NUMERO",
      },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id")
      .eq("code", "ZURICH")
      .maybeSingle();

    if (companyError) {
      throw new Error(companyError.message);
    }

    if (!company) {
      return Response.json(
        { success: false, error: "Companhia Zurich não encontrada." },
        { status: 404 },
      );
    }

    const { data: policy, error: policyError } = await admin
      .from("policies")
      .select("id, policy_number, provider_metadata")
      .eq("company_id", company.id)
      .eq("policy_number", apolice)
      .maybeSingle();

    if (policyError) {
      throw new Error(policyError.message);
    }

    if (!policy) {
      return Response.json(
        {
          success: false,
          error: "Apólice não encontrada no CRM",
        },
        { status: 404 },
      );
    }

    const currentMetadata: Record<string, unknown> =
      policy.provider_metadata &&
      typeof policy.provider_metadata === "object" &&
      !Array.isArray(policy.provider_metadata)
        ? (policy.provider_metadata as Record<string, unknown>)
        : {};

    const account = pickAccount(currentMetadata);

    // Em série, sem paralelismo: são duas consultas a uma só apólice.
    const failures: string[] = [];
    let objects: NonNullable<
      Awaited<ReturnType<typeof obterObjetosPorNrApolice>>["ListaObjetos"]
    > = [];
    let coverages: NonNullable<
      Awaited<ReturnType<typeof obterCoberturasPorApolice>>["ListaCoberturas"]
    > = [];

    try {
      objects = (
        (await obterObjetosPorNrApolice(apolice, account)).ListaObjetos ?? []
      ).filter(hasZurichObjectContent);
    } catch (error) {
      failures.push(`objetos: ${errorText(error)}`);
    }

    try {
      coverages = (
        (await obterCoberturasPorApolice(apolice, account)).ListaCoberturas ??
        []
      ).filter(hasZurichCoverageContent);
    } catch (error) {
      failures.push(`coberturas: ${errorText(error)}`);
    }

    if (objects.length === 0 && coverages.length === 0) {
      return Response.json({
        success: false,
        applied: false,
        policy: maskIdentifier(apolice),
        error: "Sem dados válidos de objetos nem de coberturas; nada a gravar.",
        failures,
      });
    }

    const fetchedAt = new Date().toISOString();

    const { metadata: patch, diagnostics } = buildZurichEnrichmentPatch(
      currentMetadata,
      {
        objects:
          objects.length > 0
            ? { source: "POLICY_LOOKUP", fetchedAt, items: objects }
            : null,
        coverages:
          coverages.length > 0
            ? { source: "POLICY_LOOKUP", fetchedAt, items: coverages }
            : null,
      },
    );

    const summary = {
      policy: maskIdentifier(apolice),
      account: account?.key ?? "default",
      objects: diagnostics.objectCount,
      coverages: diagnostics.coverageCount,
      vehicleSelection: diagnostics.vehicleSelection?.status ?? null,
      unparsableNumbers: diagnostics.unparsableNumbers,
      wouldSetKeys: Object.keys(patch),
      failures,
    };

    if (!apply) {
      return Response.json({
        success: true,
        applied: false,
        hint: "Pré-visualização: nada foi gravado. Acrescenta &apply=1 para gravar.",
        ...summary,
      });
    }

    const { error: updateError } = await admin
      .from("policies")
      .update({
        provider_metadata: { ...currentMetadata, ...patch },
      })
      .eq("id", policy.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return Response.json({
      success: true,
      applied: true,
      ...summary,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: errorText(error),
      },
      { status: 500 },
    );
  }
}
