import type { ElementType } from "react";
import {
  Briefcase,
  Car,
  HeartPulse,
  House,
  Plane,
  ShieldPlus,
  Umbrella,
} from "lucide-react";

import type { ProductLine } from "@/lib/quoting/domain/types";

/*
 * Ramos apresentados no simulador. Usa os mesmos códigos do motor de
 * cotações (ProductLine).
 *
 * `available` diz se já existe formulário para o ramo. Acrescentar um ramo
 * = pôr `available: true` aqui e ligar o seu formulário no workspace; a
 * área de resultados não depende do ramo.
 */
export type SimulatorLine = {
  id: ProductLine;
  label: string;
  icon: ElementType;
  available: boolean;
};

export const SIMULATOR_LINES: SimulatorLine[] = [
  { id: "AUTO", label: "Automóvel", icon: Car, available: true },
  { id: "HOME", label: "Multirriscos", icon: House, available: false },
  { id: "TRAVEL", label: "Viagem", icon: Plane, available: false },
  { id: "WORK_ACCIDENT", label: "Acidentes de trabalho", icon: Briefcase, available: false },
  { id: "PERSONAL_ACCIDENT", label: "Acidentes pessoais", icon: ShieldPlus, available: false },
  { id: "HEALTH", label: "Saúde", icon: HeartPulse, available: false },
  { id: "LIFE", label: "Vida", icon: Umbrella, available: false },
];

export function getSimulatorLine(id: ProductLine): SimulatorLine | undefined {
  return SIMULATOR_LINES.find((line) => line.id === id);
}
