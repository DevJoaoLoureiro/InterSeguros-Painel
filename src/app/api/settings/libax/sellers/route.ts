import { NextResponse } from "next/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ==========================================
// GET
// Listar mappings + utilizadores disponíveis
// ==========================================

export async function GET() {
  try {
    const supabase =
      createAdminClient();

    // ----------------------------------------
    // MAPPINGS LIBAX
    // ----------------------------------------

    const {
      data: mappings,
      error: mappingsError,
    } = await supabase
      .from("libax_seller_mappings")
      .select(`
        id,
        libax_seller_id,
        libax_seller_name,
        user_id,
        active,
        created_at,
        updated_at
      `)
      .order(
        "libax_seller_name",
        {
          ascending: true,
        },
      );

    if (mappingsError) {
      throw new Error(
        `Erro ao carregar mappings: ${mappingsError.message}`,
      );
    }

    // ----------------------------------------
    // UTILIZADORES CRM
    // ----------------------------------------

    const {
      data: users,
      error: usersError,
    } = await supabase
      .from("profiles")
      .select(`
        id,
        full_name,
        store_id
      `)
      .order(
        "full_name",
        {
          ascending: true,
        },
      );

    if (usersError) {
      throw new Error(
        `Erro ao carregar utilizadores: ${usersError.message}`,
      );
    }

    return NextResponse.json({
      success: true,
      mappings:
        mappings ?? [],
      users:
        users ?? [],
    });
  } catch (error) {
    console.error(
      "Erro API mappings Libax:",
      error,
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      {
        status: 500,
      },
    );
  }
}

// ==========================================
// PUT
// Criar / alterar associação
// ==========================================

export async function PUT(
  request: Request,
) {
  try {
    const body =
      await request.json();

    const libaxSellerId =
      Number(
        body.libaxSellerId,
      );

    const libaxSellerName =
      typeof body.libaxSellerName ===
      "string"
        ? body.libaxSellerName.trim()
        : "";

    const userId =
      typeof body.userId === "string"
        ? body.userId
        : null;

    // ----------------------------------------
    // VALIDAR
    // ----------------------------------------

    if (
      !Number.isInteger(
        libaxSellerId,
      ) ||
      libaxSellerId <= 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Seller ID inválido.",
        },
        {
          status: 400,
        },
      );
    }

    if (!libaxSellerName) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Nome do seller inválido.",
        },
        {
          status: 400,
        },
      );
    }

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Utilizador não selecionado.",
        },
        {
          status: 400,
        },
      );
    }

    const supabase =
      createAdminClient();

    // ----------------------------------------
    // VERIFICAR UTILIZADOR
    // ----------------------------------------

    const {
      data: profile,
      error: profileError,
    } = await supabase
      .from("profiles")
      .select(`
        id,
        full_name,
        store_id
      `)
      .eq(
        "id",
        userId,
      )
      .maybeSingle();

    if (
      profileError ||
      !profile
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Utilizador não encontrado.",
        },
        {
          status: 404,
        },
      );
    }

    // ----------------------------------------
    // GUARDAR MAPPING
    // ----------------------------------------

    const {
      data: mapping,
      error: mappingError,
    } = await supabase
      .from(
        "libax_seller_mappings",
      )
      .upsert(
        {
          libax_seller_id:
            libaxSellerId,

          libax_seller_name:
            libaxSellerName,

          user_id:
            userId,

          active:
            true,

          updated_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "libax_seller_id",
        },
      )
      .select(`
        id,
        libax_seller_id,
        libax_seller_name,
        user_id,
        active
      `)
      .single();

    if (mappingError) {
      throw new Error(
        `Erro ao guardar mapping: ${mappingError.message}`,
      );
    }

    // ----------------------------------------
    // ATUALIZAR TODAS AS APÓLICES DESSE SELLER
    // ----------------------------------------

    const {
      error: policiesError,
      count,
    } = await supabase
      .from("policies")
      .update(
        {
          assigned_user_id:
            profile.id,

          store_id:
            profile.store_id,

          responsible_name:
            libaxSellerName,

          responsible_pending:
            false,

          responsible_last_checked_at:
            new Date().toISOString(),
        },
        {
          count: "exact",
        },
      )
      .eq(
        "source",
        "libax",
      )
      .eq(
        "libax_seller_id",
        libaxSellerId,
      );

    if (policiesError) {
      throw new Error(
        `Mapping guardado, mas ocorreu um erro ao atualizar as apólices: ${policiesError.message}`,
      );
    }

    return NextResponse.json({
      success: true,

      mapping,

      user: {
        id:
          profile.id,

        fullName:
          profile.full_name,

        storeId:
          profile.store_id,
      },

      policiesUpdated:
        count ?? 0,
    });
  } catch (error) {
    console.error(
      "Erro ao associar seller Libax:",
      error,
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      {
        status: 500,
      },
    );
  }
}