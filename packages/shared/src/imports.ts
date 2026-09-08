import type { MetadataFields } from "./metadata.js";
export interface ImportFile {
  id: string;
  name: string;
  hash: string;
  type: string;
  size: number;
}
export interface ImportItem {
  id: string;
  ordinal: number;
  fileId: string | null;
  label: string;
  metadata: MetadataFields | null;
  sourceMetadata?: MetadataFields | null;
  raw: unknown;
  source: string;
  externalId: string;
  sourceUrl: string;
  authoritative: boolean;
  fingerprint: string;
  notes: string[];
  attachments: ImportFile[];
  warnings: string[];
  error: string;
  included: boolean;
  status: "pending" | "created" | "reused" | "failed" | "skipped";
  workId: string | null;
  matchId: string | null;
  matchTitle: string | null;
}
export interface ImportSession {
  id: string;
  collectionId: string;
  state: "preview" | "running" | "complete" | "partial";
  revision: number;
  files: ImportFile[];
  warnings: string[];
  items: ImportItem[];
  createdAt: string;
  updatedAt: string;
}
