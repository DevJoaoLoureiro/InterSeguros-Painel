"use client";

import { useState, type ReactNode } from "react";
import { Calculator, ChevronDown, Info } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  COVERAGE_PRESETS,
  DEDUCTIBLE_OPTIONS,
  PAYMENT_FREQUENCY_OPTIONS,
  USAGE_OPTIONS,
  applyCoveragePreset,
  formatPostalCode,
  formatRegistration,
  getAgeInYears,
  getCoveragePreset,
  getYearsSince,
  toIsoDate,
  type CoveragePresetId,
} from "./auto-values";
import {
  CheckRow,
  ChoiceGroup,
  Field,
  Stepper,
  inputClass,
} from "./fields";
import type {
  AutoFormErrors,
  AutoFormValues,
  ClaimsAnswer,
  PrefilledFields,
  SimulatorVehicle,
} from "./types";

type AutoFormProps = {
  values: AutoFormValues;
  errors: AutoFormErrors;
  prefilled: PrefilledFields;

  /** Viaturas do cliente selecionado (atalhos para a matrícula). */
  vehicles: SimulatorVehicle[];

  /** Bloqueia o formulário enquanto se calcula. */
  disabled: boolean;

  /** Campos essenciais ainda vazios, para o texto de ajuda do botão. */
  missing: string[];

  onChange: (patch: Partial<AutoFormValues>) => void;
  onPickVehicle: (registration: string) => void;
  onSubmit: () => void;
};

const EXTRA_COVERAGES = [
  { key: "ownDamage", label: "Danos próprios (colisão)" },
  { key: "fire", label: "Incêndio" },
  { key: "theft", label: "Roubo" },
  { key: "glass", label: "Vidros" },
  { key: "assistance", label: "Assistência em viagem" },
  { key: "legalProtection", label: "Proteção jurídica" },
] as const;

const CLAIMS_OPTIONS: { value: ClaimsAnswer; label: string }[] = [
  { value: "UNKNOWN", label: "Não sei" },
  { value: "NONE", label: "Sem sinistros" },
  { value: "SOME", label: "Com sinistros" },
];

function describeYears(years: number | null, suffix = ""): string | null {
  if (years === null) return null;

  return `${years} ${years === 1 ? "ano" : "anos"}${suffix}`;
}

export function AutoForm({
  values,
  errors,
  prefilled,
  vehicles,
  disabled,
  missing,
  onChange,
  onPickVehicle,
  onSubmit,
}: AutoFormProps) {
  const [showCoverageDetails, setShowCoverageDetails] = useState(false);
  const [showRefine, setShowRefine] = useState(false);

  const today = toIsoDate();
  const preset = getCoveragePreset(values.coverages);
  const hasOwnDamage = values.coverages.ownDamage;

  const age = getAgeInYears(values.birthDate);
  const licenceYears = getYearsSince(values.drivingLicenceDate);

  function setCoverage(
    key: keyof AutoFormValues["coverages"],
    checked: boolean,
  ) {
    onChange({ coverages: { ...values.coverages, [key]: checked } });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]"
    >
      <div className="border-b border-[#edf0f2] px-5 py-4">
        <h2 className="font-semibold text-[#20242a]">Dados do risco</h2>

        <p className="mt-1 text-sm text-[#7d848e]">
          Apenas o essencial. O resto é opcional e pode ser afinado depois.
        </p>
      </div>

      <fieldset
        disabled={disabled}
        className="m-0 min-w-0 space-y-6 border-0 p-5"
      >
        {/* ESSENCIAL */}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="sim-registration"
            label="Matrícula"
            fromCrm={prefilled.registration}
            error={errors.registration}
          >
            <input
              id="sim-registration"
              value={values.registration}
              onChange={(event) =>
                onChange({
                  registration: formatRegistration(event.target.value),
                })
              }
              placeholder="AB-12-CD"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              aria-invalid={!!errors.registration}
              aria-describedby={
                errors.registration ? "sim-registration-error" : undefined
              }
              className={cn(inputClass, "font-medium tracking-wider uppercase")}
            />
          </Field>

          <Field
            id="sim-postal-code"
            label="Código postal"
            fromCrm={prefilled.postalCode}
            error={errors.postalCode}
          >
            <input
              id="sim-postal-code"
              value={values.postalCode}
              onChange={(event) =>
                onChange({ postalCode: formatPostalCode(event.target.value) })
              }
              placeholder="0000-000"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={8}
              aria-invalid={!!errors.postalCode}
              aria-describedby={
                errors.postalCode ? "sim-postal-code-error" : undefined
              }
              className={inputClass}
            />
          </Field>

          {vehicles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <span className="text-xs text-[#8a9099]">
                Viaturas do cliente:
              </span>

              {vehicles.map((vehicle) => (
                <button
                  key={vehicle.registration}
                  type="button"
                  onClick={() => onPickVehicle(vehicle.registration)}
                  aria-pressed={values.registration === vehicle.registration}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold tracking-wide transition",
                    values.registration === vehicle.registration
                      ? "border-[#ff4b0a] bg-orange-50 text-[#b83a06]"
                      : "border-[#e1e4e8] bg-white text-[#353b44] hover:border-[#c9ced5]",
                  )}
                >
                  {vehicle.registration}

                  {vehicle.active && (
                    <span className="rounded bg-green-100 px-1 py-px text-[10px] font-semibold uppercase text-green-700">
                      ativa
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <Field
            id="sim-birth-date"
            label="Data de nascimento"
            fromCrm={prefilled.birthDate}
            hint={describeYears(age) ?? undefined}
            error={errors.birthDate}
          >
            <input
              id="sim-birth-date"
              type="date"
              value={values.birthDate}
              min="1900-01-01"
              max={today}
              onChange={(event) => onChange({ birthDate: event.target.value })}
              aria-invalid={!!errors.birthDate}
              aria-describedby={
                errors.birthDate ? "sim-birth-date-error" : undefined
              }
              className={inputClass}
            />
          </Field>

          <Field
            id="sim-licence-date"
            label="Data da carta"
            fromCrm={prefilled.drivingLicenceDate}
            hint={describeYears(licenceYears, " de carta") ?? undefined}
            error={errors.drivingLicenceDate}
          >
            <input
              id="sim-licence-date"
              type="date"
              value={values.drivingLicenceDate}
              min="1900-01-01"
              max={today}
              onChange={(event) =>
                onChange({ drivingLicenceDate: event.target.value })
              }
              aria-invalid={!!errors.drivingLicenceDate}
              aria-describedby={
                errors.drivingLicenceDate
                  ? "sim-licence-date-error"
                  : undefined
              }
              className={inputClass}
            />
          </Field>

          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-[#353b44]">
              Uso da viatura
            </p>

            <ChoiceGroup
              name="sim-usage"
              label="Uso da viatura"
              value={values.usage}
              options={USAGE_OPTIONS}
              onChange={(usage) => onChange({ usage })}
            />
          </div>
        </div>

        <hr className="border-[#edf0f2]" />

        {/* COBERTURA */}

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-[#353b44]">
              Cobertura pretendida
            </p>

            <ChoiceGroup<CoveragePresetId>
              name="sim-coverage"
              label="Cobertura pretendida"
              variant="card"
              value={preset === "CUSTOM" ? null : preset}
              options={COVERAGE_PRESETS.map(({ id, label, description }) => ({
                value: id,
                label,
                description,
              }))}
              onChange={(presetId) =>
                onChange({
                  coverages: applyCoveragePreset(values.coverages, presetId),
                })
              }
            />

            {preset === "CUSTOM" && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#b83a06]">
                <Info className="h-3.5 w-3.5" />
                Coberturas personalizadas
              </p>
            )}

            <Disclosure
              open={showCoverageDetails}
              onToggle={() => setShowCoverageDetails((open) => !open)}
              label="Ajustar coberturas"
              className="mt-3"
            >
              <p className="mb-2 text-xs text-[#8a9099]">
                A responsabilidade civil é obrigatória e está sempre incluída.
              </p>

              <div className="grid gap-2 sm:grid-cols-2">
                {EXTRA_COVERAGES.map(({ key, label }) => (
                  <CheckRow
                    key={key}
                    label={label}
                    checked={values.coverages[key]}
                    onChange={(checked) => setCoverage(key, checked)}
                  />
                ))}
              </div>
            </Disclosure>
          </div>

          {/* Franquia: só faz sentido com danos próprios. */}
          {hasOwnDamage && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-[#353b44]">
                Franquia
              </p>

              <ChoiceGroup
                name="sim-deductible"
                label="Franquia"
                value={values.deductible === null ? "ANY" : String(values.deductible)}
                options={[
                  { value: "ANY", label: "Indiferente" },
                  ...DEDUCTIBLE_OPTIONS.map((amount) => ({
                    value: String(amount),
                    label:
                      amount === 0
                        ? "Sem franquia"
                        : `${amount.toLocaleString("pt-PT")} €`,
                  })),
                ]}
                onChange={(next) =>
                  onChange({ deductible: next === "ANY" ? null : Number(next) })
                }
              />
            </div>
          )}
        </div>

        <hr className="border-[#edf0f2]" />

        {/* REFINAR (opcional) */}

        <Disclosure
          // Um erro dentro da secção não pode ficar escondido.
          open={showRefine || !!errors.vehicleValue}
          onToggle={() => setShowRefine((open) => !open)}
          label="Refinar estimativa"
          badge="opcional"
          summary={`Fracionamento, sinistros${hasOwnDamage ? " e valor da viatura" : ""}`}
        >
          <div className="space-y-5">
            <div>
              <p className="mb-1.5 text-sm font-medium text-[#353b44]">
                Fracionamento
              </p>

              <ChoiceGroup
                name="sim-frequency"
                label="Fracionamento do pagamento"
                value={values.paymentFrequency}
                options={PAYMENT_FREQUENCY_OPTIONS}
                onChange={(paymentFrequency) => onChange({ paymentFrequency })}
              />
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-[#353b44]">
                Sinistros nos últimos 3 anos
              </p>

              <ChoiceGroup
                name="sim-claims"
                label="Sinistros nos últimos 3 anos"
                value={values.claimsAnswer}
                options={CLAIMS_OPTIONS}
                onChange={(claimsAnswer) => onChange({ claimsAnswer })}
              />

              {values.claimsAnswer === "SOME" && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field id="sim-claims-count" label="Nº de sinistros">
                    <Stepper
                      id="sim-claims-count"
                      value={values.claimsCount}
                      min={1}
                      max={10}
                      onChange={(claimsCount) =>
                        onChange({
                          claimsCount,
                          atFaultClaims: Math.min(
                            values.atFaultClaims,
                            claimsCount,
                          ),
                        })
                      }
                    />
                  </Field>

                  <Field id="sim-claims-fault" label="Com culpa do condutor">
                    <Stepper
                      id="sim-claims-fault"
                      value={values.atFaultClaims}
                      min={0}
                      max={values.claimsCount}
                      onChange={(atFaultClaims) => onChange({ atFaultClaims })}
                    />
                  </Field>
                </div>
              )}
            </div>

            {hasOwnDamage && (
              <Field
                id="sim-vehicle-value"
                label="Valor da viatura"
                optional
                error={errors.vehicleValue}
                hint="Valor de mercado aproximado, em euros."
              >
                <input
                  id="sim-vehicle-value"
                  value={values.vehicleValue}
                  onChange={(event) =>
                    onChange({ vehicleValue: event.target.value })
                  }
                  placeholder="Ex.: 12 500"
                  inputMode="decimal"
                  aria-invalid={!!errors.vehicleValue}
                  aria-describedby={
                    errors.vehicleValue ? "sim-vehicle-value-error" : undefined
                  }
                  className={cn(inputClass, "sm:max-w-[220px]")}
                />
              </Field>
            )}
          </div>
        </Disclosure>
      </fieldset>

      {/* AÇÃO PRINCIPAL */}

      <div className="flex flex-col gap-3 border-t border-[#edf0f2] bg-[#fafbfc] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[#7d848e]" aria-live="polite">
          {missing.length > 0
            ? `Falta indicar: ${missing.join(", ")}.`
            : "Tudo pronto para calcular."}
        </p>

        <button
          type="submit"
          disabled={disabled}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e94308] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Calculator className="h-4 w-4" />

          {disabled ? "A calcular…" : "Calcular simulação"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Divulgação progressiva
 * ------------------------------------------------------------------ */

function Disclosure({
  open,
  onToggle,
  label,
  badge,
  summary,
  className,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  badge?: string;
  summary?: string;
  className?: string;
  children: ReactNode;
}) {
  const regionId = `disclosure-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        className="group flex w-full items-center gap-2 rounded-lg text-left text-sm font-medium text-[#353b44] outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[#7a818b] transition-transform",
            open && "rotate-180",
          )}
        />

        {label}

        {badge && (
          <span className="text-xs font-normal text-[#8a9099]">{badge}</span>
        )}

        {summary && !open && (
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-[#8a9099]">
            · {summary}
          </span>
        )}
      </button>

      {open && (
        <div id={regionId} className="mt-3">
          {children}
        </div>
      )}
    </div>
  );
}
