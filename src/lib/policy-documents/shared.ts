/*
 * Documentos das apólices: regras partilhadas entre o browser e o
 * servidor (sem imports de servidor). Ficheiros: as mesmas regras dos
 * envios dos parceiros (PDF ou imagem, até 15 MB).
 */

export {
  FILE_ACCEPT,
  fileMimeType,
  validateUploadFile,
  type UploadFileMeta,
} from "@/lib/partner-submissions/shared";

export const POLICY_DOCUMENTS_BUCKET = "policy-documents";
export const MAX_FILES_PER_UPLOAD = 10;

export const DOC_TYPES = [
  "APOLICE",
  "CONDICOES_GERAIS",
  "CARTA_VERDE",
  "RECIBO",
  "PROPOSTA",
  "DOCUMENTO_CLIENTE",
  "OUTRO",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  APOLICE: "Apólice / Condições particulares",
  CONDICOES_GERAIS: "Condições gerais",
  CARTA_VERDE: "Carta verde",
  RECIBO: "Recibo",
  PROPOSTA: "Proposta / Simulação",
  DOCUMENTO_CLIENTE: "Documento do cliente",
  OUTRO: "Outro",
};

export type PolicyDocument = {
  id: string;
  createdAt: string;
  docType: DocType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
};
