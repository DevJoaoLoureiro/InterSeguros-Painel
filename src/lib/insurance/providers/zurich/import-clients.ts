import { createAdminClient } from "@/lib/supabase/admin";
import { getClientesDoDia } from "./client";
import { ZurichClienteFicheiro } from "./file-parser";

/**
 * Converte "DD-MM-AAAA HH:mm:ss" para "AAAA-MM-DD" (formato de
 * coluna `date`), ou null se vazio / data-sentinela 01-01-1900.
 */
function toDateOnly(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed || trimmed.startsWith("01-01-1900")) {
    return null;
  }

  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

/**
 * Junta CodigoPostal + OrdemPostal no formato português "NNNN-NNN".
 * Ex: CodigoPostal "4755" + OrdemPostal "266" -> "4755-266".
 */
function buildPostalCode(cliente: ZurichClienteFicheiro): string | null {
  const codigo = cliente.CodigoPostal.trim();
  const ordem = cliente.OrdemPostal.trim();

  if (!codigo) {
    return null;
  }

  return ordem ? `${codigo}-${ordem}` : codigo;
}

type ClientRow = {
  name: string;
  nif: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
};

function mapClienteToRow(cliente: ZurichClienteFicheiro): ClientRow | null {
  const nif = cliente.NIF.trim();

  // Sem NIF não conseguimos identificar/evitar duplicados -
  // ignoramos esse registo (podes decidir gravar mesmo assim
  // se preferires, mas fica sem forma fiável de fazer upsert).
  if (!nif) {
    return null;
  }

  // Telemóvel é o contacto mais fiável nos dados da Zurich;
  // cai para Telefone fixo se não houver telemóvel.
  const phone = cliente.Telemovel.trim() || cliente.Telefone.trim() || null;

  // LocalidadePostal costuma vir preenchido (a "Localidade" simples
  // apareceu vazia nos exemplos que já vimos).
  const city =
    cliente.LocalidadePostal.trim() || cliente.Localidade.trim() || null;

  return {
    name: cliente.NomeCliente.trim(),
    nif,
    email: cliente.Email.trim() || null,
    phone,
    birth_date: toDateOnly(cliente.DataNascimento),
    street: cliente.Morada.trim() || null,
    postal_code: buildPostalCode(cliente),
    city,
    country: cliente.Pais.trim() || null,
  };
}

export type ImportClientesResult = {
  totalNoFicheiro: number;
  totalImportados: number;
  ignoradosSemNif: number;
};

/**
 * Vai buscar os clientes do ficheiro diário da Zurich e faz
 * upsert na tabela `clients`, usando o NIF como chave de
 * conflito (assume que `nif` tem uma constraint UNIQUE).
 *
 * Data no formato AAAA-MM-DD (por omissão, hoje).
 */
export async function importClientesZurichDoDia(
  data?: string,
): Promise<ImportClientesResult> {
  const clientesFicheiro = await getClientesDoDia(data);

  const rows = clientesFicheiro
    .map(mapClienteToRow)
    .filter((row): row is ClientRow => row !== null);

  const ignoradosSemNif = clientesFicheiro.length - rows.length;

  if (rows.length === 0) {
    return {
      totalNoFicheiro: clientesFicheiro.length,
      totalImportados: 0,
      ignoradosSemNif,
    };
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("clients")
    .upsert(rows, { onConflict: "nif" });

  if (error) {
    throw new Error(`Erro ao gravar clientes na BD: ${error.message}`);
  }

  return {
    totalNoFicheiro: clientesFicheiro.length,
    totalImportados: rows.length,
    ignoradosSemNif,
  };
}