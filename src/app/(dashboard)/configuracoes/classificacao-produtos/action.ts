"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

export type UnclassifiedProduct = {
  productCode: string;
  productName: string | null;
  policiesCount: number;
};

export type InsuranceLineOption = {
  id: string;
  code: string;
  name: string;
  planType: string;
};

export type CompanyOption = {
  id: string;
  code: string;
  name: string;
};

/*
 * Lista todas as companhias existentes, para o
 * seletor de filtro na página.
 */
export async function getCompanies(): Promise<CompanyOption[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("companies")
    .select("id, code, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Erro ao carregar companhias: ${error.message}`,
    );
  }

  return data ?? [];
}

/*
 * Lista os produtos de uma companhia que ainda não
 * têm insurance_line_id atribuído a nenhuma policy.
 *
 * Reflete a realidade atual das policies, não
 * o estado de provider_products — porque é o que
 * o dashboard efetivamente usa.
 */
export async function getUnclassifiedProducts(
  companyCode: string,
): Promise<UnclassifiedProduct[]> {
  const supabase = createAdminClient();

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("code", companyCode)
    .single();

  if (companyError || !company) {
    throw new Error(
      `Companhia ${companyCode} não encontrada: ${
        companyError?.message ?? "sem resultado"
      }`,
    );
  }

  const { data, error } = await supabase
    .from("policies")
    .select("product_code, product_name")
    .eq("company_id", company.id)
    .is("insurance_line_id", null);

  if (error) {
    throw new Error(
      `Erro ao carregar produtos por classificar: ${error.message}`,
    );
  }

  const grouped = new Map<string, UnclassifiedProduct>();

  for (const row of data ?? []) {
    const code = row.product_code;

    if (!code) {
      continue;
    }

    const existing = grouped.get(code);

    grouped.set(code, {
      productCode: code,
      productName: row.product_name ?? existing?.productName ?? null,
      policiesCount: (existing?.policiesCount ?? 0) + 1,
    });
  }

  return Array.from(grouped.values()).sort(
    (a, b) => b.policiesCount - a.policiesCount,
  );
}

export async function getInsuranceLineOptions(): Promise<
  InsuranceLineOption[]
> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("insurance_lines")
    .select("id, code, name, plan_type")
    .order("plan_type", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Erro ao carregar ramos: ${error.message}`,
    );
  }

  return (data ?? []).map((line) => ({
    id: line.id,
    code: line.code,
    name: line.name,
    planType: line.plan_type,
  }));
}

/*
 * Grava a classificação de um produto, para
 * qualquer companhia:
 *
 * 1. upsert em provider_products, para que o
 *    próximo sync já venha classificado.
 *
 * 2. atualiza retroativamente as policies já
 *    existentes com este product_code, para o
 *    dashboard refletir imediatamente.
 */
export async function classifyProduct({
  companyCode,
  productCode,
  productName,
  insuranceLineId,
}: {
  companyCode: string;
  productCode: string;
  productName: string | null;
  insuranceLineId: string;
}) {
  const supabase = createAdminClient();

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("code", companyCode)
    .single();

  if (companyError || !company) {
    throw new Error(
      `Companhia ${companyCode} não encontrada: ${
        companyError?.message ?? "sem resultado"
      }`,
    );
  }

  // ----------------------------------------
  // 1. provider_products
  // ----------------------------------------

  const { data: existing, error: existingError } = await supabase
    .from("provider_products")
    .select("id")
    .eq("company_id", company.id)
    .eq("provider_code", productCode)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Erro ao verificar produto existente: ${existingError.message}`,
    );
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("provider_products")
      .update({
        insurance_line_id: insuranceLineId,
        provider_name: productName,
        active: true,
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(
        `Erro ao atualizar produto: ${updateError.message}`,
      );
    }
  } else {
    const { error: insertError } = await supabase
      .from("provider_products")
      .insert({
        company_id: company.id,
        provider_code: productCode,
        provider_name: productName,
        insurance_line_id: insuranceLineId,
        active: true,
      });

    if (insertError) {
      throw new Error(
        `Erro ao criar produto: ${insertError.message}`,
      );
    }
  }

  // ----------------------------------------
  // 2. Atualizar policies retroativamente
  // ----------------------------------------

  const { error: policiesError } = await supabase
    .from("policies")
    .update({
      insurance_line_id: insuranceLineId,
    })
    .eq("company_id", company.id)
    .eq("product_code", productCode)
    .is("insurance_line_id", null);

  if (policiesError) {
    throw new Error(
      `Produto classificado, mas erro ao atualizar apólices existentes: ${policiesError.message}`,
    );
  }

  revalidatePath("/configuracoes/classificacao-produtos");
  revalidatePath("/dashboard");
}