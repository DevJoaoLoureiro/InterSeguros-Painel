import { createAdminClient } from "@/lib/supabase/admin";
import {
  getZurichAccounts,
  obterObjetosPorNrApolice,
  type ZurichAccount,
} from "@/lib/insurance/providers/zurich/client";
import {
  maskIdentifier,
  sanitizeZurichText,
} from "@/lib/insurance/providers/zurich/log-safety";
import {
  buildZurichEnrichmentPatch,
  hasZurichObjectContent,
  isZurichAutoPolicy,
} from "@/lib/insurance/providers/zurich/risk-enrichment";

/**
 * Preenche a matrícula (e os objetos) de apólices Zurich Auto que ainda
 * não a têm, por lotes.
 *
 *   GET ?limit=20&offset=0            -> PRÉ-VISUALIZAÇÃO: consulta a Zurich e
 *                                        a BD, NÃO escreve nada.
 *   GET ?limit=20&offset=0&apply=1    -> grava.
 *
 * Diferenças face à versão anterior (que substituía `insuredObject` por
 * uma versão mais pobre e chamava a Zurich para qualquer ramo):
 *   - só apólices Auto;
 *   - a conta é a da loja da apólice (não a default);
 *   - o que grava junta-se ao metadata existente e nunca apaga nada
 *     (buildZurichEnrichmentPatch);
 *   - consultas em série, com pausa, e lote máximo reduzido;
 *   - erros e identificadores sanitizados/mascarados.
 *
 * NÃO é o backfill definitivo (esse será um processo próprio e
 * retomável); é só esta ferramenta de diagnóstico, segura por omissão.
 */

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const PAUSE_MS = 250;

function errorText(error: unknown): string {
  return sanitizeZurichText(
    error instanceof Error ? error.message : String(error),
  );
}

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

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const limit = Math.min(
    Math.max(Number(searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const offset = Math.max(Number(searchParams.get("offset") ?? "0") || 0, 0);
  const apply = searchParams.get("apply") === "1";

  const admin = createAdminClient();

  try {
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, code, name")
      .eq("code", "ZURICH")
      .maybeSingle();

    if (companyError) {
      throw new Error(companyError.message);
    }

    if (!company) {
      return Response.json(
        {
          success: false,
          error: "Companhia Zurich não encontrada.",
        },
        { status: 404 },
      );
    }

    const { data: policies, error: policiesError } = await admin
      .from("policies")
      .select(`
        id,
        policy_number,
        product_code,
        product_name,
        provider_metadata
      `)
      .eq("company_id", company.id)
      .order("policy_number", { ascending: true })
      .range(offset, offset + limit - 1);

    if (policiesError) {
      throw new Error(policiesError.message);
    }

    const results = {
      processed: 0,
      notAuto: 0,
      alreadyHadRegistration: 0,
      noObjects: 0,
      candidates: 0,
      updated: 0,
      wouldUpdate: 0,
      vehicleNone: 0,
      vehicleAmbiguous: 0,
      failed: 0,
      errors: [] as { policy: string; error: string }[],
    };

    for (const policy of policies ?? []) {
      results.processed++;

      try {
        const metadata: Record<string, unknown> =
          policy.provider_metadata &&
          typeof policy.provider_metadata === "object" &&
          !Array.isArray(policy.provider_metadata)
            ? (policy.provider_metadata as Record<string, unknown>)
            : {};

        if (
          !isZurichAutoPolicy({
            productCode: policy.product_code,
            productName: policy.product_name,
          })
        ) {
          results.notAuto++;
          continue;
        }

        // Se já tem matrícula, não precisamos voltar à Zurich.
        if (
          typeof metadata.vehicleRegistration === "string" &&
          metadata.vehicleRegistration.trim() !== ""
        ) {
          results.alreadyHadRegistration++;
          continue;
        }

        results.candidates++;

        const objects = (
          (await obterObjetosPorNrApolice(
            policy.policy_number,
            pickAccount(metadata),
          )).ListaObjetos ?? []
        ).filter(hasZurichObjectContent);

        await pause(PAUSE_MS);

        if (objects.length === 0) {
          results.noObjects++;
          continue;
        }

        const { metadata: patch, diagnostics } = buildZurichEnrichmentPatch(
          metadata,
          {
            objects: {
              source: "POLICY_LOOKUP",
              fetchedAt: new Date().toISOString(),
              items: objects,
            },
          },
        );

        const selection = diagnostics.vehicleSelection?.status;

        if (selection === "NONE") {
          results.vehicleNone++;
        } else if (selection === "AMBIGUOUS") {
          results.vehicleAmbiguous++;
        }

        if (!apply) {
          results.wouldUpdate++;
          continue;
        }

        const { error: updateError } = await admin
          .from("policies")
          .update({
            provider_metadata: { ...metadata, ...patch },
          })
          .eq("id", policy.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        results.updated++;
      } catch (error) {
        results.failed++;

        results.errors.push({
          policy: maskIdentifier(policy.policy_number),
          error: errorText(error),
        });
      }
    }

    return Response.json({
      success: true,
      applied: apply,
      ...(apply
        ? {}
        : {
            hint: "Pré-visualização: nada foi gravado. Acrescenta &apply=1 para gravar.",
          }),

      batch: {
        offset,
        limit,
        returned: policies?.length ?? 0,
        nextOffset:
          (policies?.length ?? 0) === limit ? offset + limit : null,
      },

      results,
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
