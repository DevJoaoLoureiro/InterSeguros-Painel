import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const insuranceTypes = [
  "Automóvel",
  "Vida",
  "Acidentes pessoais",
  "Acidentes de trabalho",
  "Multirriscos",
  "Outros",
] as const;

type InsuranceType = (typeof insuranceTypes)[number];

function isInsuranceType(value: unknown): value is InsuranceType {
  return (
    typeof value === "string" &&
    insuranceTypes.includes(value as InsuranceType)
  );
}

export async function POST(request: Request) {
  try {
    const secret = process.env.CHATBOT_CRM_SECRET;

    if (!secret) {
      return NextResponse.json(
        {
          success: false,
          message: "CHATBOT_CRM_SECRET não configurado.",
        },
        { status: 500 },
      );
    }

    const authorization = request.headers.get("authorization");

    if (authorization !== `Bearer ${secret}`) {
      return NextResponse.json(
        {
          success: false,
          message: "Não autorizado.",
        },
        { status: 401 },
      );
    }

    const body: unknown = await request.json();

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Dados inválidos.",
        },
        { status: 400 },
      );
    }

    const {
      sourceReference,
      insuranceType,
      registration,
      contact,
      name,
    } = body as Record<string, unknown>;

    if (
      typeof sourceReference !== "string" ||
      sourceReference.trim().length < 10
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Referência inválida.",
        },
        { status: 400 },
      );
    }

    if (
      typeof name !== "string" ||
      name.trim().length < 3
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Nome inválido.",
        },
        { status: 400 },
      );
    }

    if (
      typeof contact !== "string" ||
      contact.trim().length < 5
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Contacto inválido.",
        },
        { status: 400 },
      );
    }

    if (!isInsuranceType(insuranceType)) {
      return NextResponse.json(
        {
          success: false,
          message: "Tipo de seguro inválido.",
        },
        { status: 400 },
      );
    }

    const answers: Record<string, string> = {};

    if (
      insuranceType === "Automóvel" &&
      typeof registration === "string"
    ) {
      answers.registration = registration;
    }

    const admin = createAdminClient();

    const { data: existingLead } = await admin
      .from("leads")
      .select("id")
      .eq("source_reference", sourceReference)
      .maybeSingle();

    if (existingLead) {
      return NextResponse.json({
        success: true,
        leadId: existingLead.id,
        duplicate: true,
      });
    }

    const { data: lead, error } = await admin
      .from("leads")
      .insert({
        source_reference: sourceReference,
        name: name.trim(),
        phone: contact.trim(),
        insurance_type: insuranceType,
        status: "nova",
        priority: "media",
        source: "chatbot",
        answers,
        privacy_consent: false,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Erro Supabase:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Erro ao guardar lead.",
        },
        { status: 500 },
      );
    }

    await admin.from("lead_history").insert({
      lead_id: lead.id,
      event_type: "lead_created",
      description: "Lead recebida através do chatbot.",
    });

    return NextResponse.json(
      {
        success: true,
        leadId: lead.id,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Erro na API pública de leads:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Erro interno.",
      },
      { status: 500 },
    );
  }
}