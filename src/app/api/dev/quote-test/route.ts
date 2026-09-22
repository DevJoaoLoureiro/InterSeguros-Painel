import { NextRequest, NextResponse } from "next/server";

import {
  registerInsurers,
  runMultiInsurerQuote,
  type QuoteRequest,
} from "@/lib/quoting";

let registered = false;

function ensureRegistered() {
  if (registered) {
    return;
  }

  registerInsurers();
  registered = true;
}

export async function POST(request: NextRequest) {
  try {
    ensureRegistered();

    const body = await request.json();

    const quoteRequest: QuoteRequest = {
      requestId: crypto.randomUUID(),

      clientId: body.clientId ?? null,

      productLine: "AUTO",

      requestedAt: new Date().toISOString(),

      customer: {
        birthDate: body.birthDate ?? null,
        postalCode: body.postalCode ?? null,
        nif: body.nif ?? null,

        drivingLicenceDate:
          body.drivingLicenceDate ?? null,

        occupation:
          body.occupation ?? null,

        usage:
          body.usage ?? "PRIVATE",
      },

      vehicle: body.vehicle
        ? {
            registration:
              body.vehicle.registration ?? null,

            make:
              body.vehicle.make ?? null,

            model:
              body.vehicle.model ?? null,

            version:
              body.vehicle.version ?? null,

            firstRegistrationDate:
              body.vehicle.firstRegistrationDate ??
              null,

            fuelType:
              body.vehicle.fuelType ?? null,

            engineCc:
              body.vehicle.engineCc ?? null,

            powerKw:
              body.vehicle.powerKw ?? null,

            marketValue:
              body.vehicle.marketValue ?? null,

            annualKm:
              body.vehicle.annualKm ?? null,
          }
        : null,

      claims: body.claims
        ? {
            claims1Y:
              body.claims.claims1Y ?? null,

            claims3Y:
              body.claims.claims3Y ?? null,

            claims5Y:
              body.claims.claims5Y ?? null,

            atFaultClaims3Y:
              body.claims.atFaultClaims3Y ?? null,
          }
        : null,

      requestedCoverages: {
        liability:
          body.requestedCoverages?.liability ??
          true,

        ownDamage:
          body.requestedCoverages?.ownDamage ??
          false,

        collision:
          body.requestedCoverages?.collision ??
          false,

        fire:
          body.requestedCoverages?.fire ??
          false,

        theft:
          body.requestedCoverages?.theft ??
          false,

        glass:
          body.requestedCoverages?.glass ??
          false,

        assistance:
          body.requestedCoverages?.assistance ??
          false,

        legalProtection:
          body.requestedCoverages
            ?.legalProtection ?? false,

        deductible:
          body.requestedCoverages?.deductible ??
          null,
      },

      paymentFrequency:
        body.paymentFrequency ?? "ANNUAL",

      bonusMalus: body.bonusMalus
        ? {
            class:
              body.bonusMalus.class ?? null,

            coefficient:
              body.bonusMalus.coefficient ??
              null,

            claimFreeYears:
              body.bonusMalus
                .claimFreeYears ?? null,
          }
        : null,

      metadata: {
        productCode:
          body.productCode ?? null,
      },
    };

    const result =
      await runMultiInsurerQuote(
        quoteRequest,
      );

    return NextResponse.json({
      ok: true,
      request: quoteRequest,
      result,
    });
  } catch (error) {
    console.error(
      "[quote-test]",
      error,
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      },
    );
  }
}