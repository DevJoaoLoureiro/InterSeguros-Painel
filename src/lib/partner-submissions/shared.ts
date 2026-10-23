/*
 * Apólices enviadas por parceiros: regras partilhadas entre o
 * formulário público (browser) e o servidor. Sem imports de servidor.
 */

export const PARTNER_SUBMISSIONS_BUCKET = "partner-submissions";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

// Iguais aos allowed_mime_types do bucket (migração).
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

export type SubmissionStatus = "DRAFT" | "NEW" | "IN_PROGRESS" | "DONE";

export const STATUS_LABELS: Record<Exclude<SubmissionStatus, "DRAFT">, string> =
  {
    NEW: "Nova",
    IN_PROGRESS: "Em tratamento",
    DONE: "Tratada",
  };

export type PartnerSubmissionInput = {
  clientName: string;
  clientNif: string;
  clientPhone: string;
  clientEmail: string;
  companyName: string;
  insuranceLine: string;
  policyNumber: string;
  premium: string;
  startDate: string;
  notes: string;
  recipientIds: string[];
};

export type UploadFileMeta = {
  name: string;
  size: number;
  type: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/* Alguns browsers (fotos HEIC do iPhone) não dão o tipo do ficheiro. */
export function fileMimeType(file: { name: string; type: string }) {
  if (file.type) return file.type;

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "";
}

/* Devolve o erro (texto para o parceiro) ou null se o ficheiro serve. */
export function validateUploadFile(file: UploadFileMeta): string | null {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `"${file.name}": só PDF ou imagens (JPG, PNG, WEBP, HEIC).`;
  }

  if (file.size <= 0) return `"${file.name}" está vazio.`;

  if (file.size > MAX_FILE_BYTES) {
    return `"${file.name}" tem mais de 15 MB.`;
  }

  return null;
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
