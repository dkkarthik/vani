import { z } from 'zod';

export const WorkStatus = z.enum(['inbox', 'to_read', 'skimming', 'reading', 'read', 'foundational', 'cited', 'rejected', 'archived']);
export type WorkStatus = z.infer<typeof WorkStatus>;

export const VerificationStatus = z.enum(['unverified', 'partial', 'verified', 'verified_multi_source', 'conflict']);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const Author = z.object({ id: z.string().optional(), given: z.string().default(''), family: z.string(), orcid: z.string().nullable().optional() });
export type Author = z.infer<typeof Author>;

export const Work = z.object({
  id: z.string(),
  title: z.string(),
  abstract: z.string().default(''),
  year: z.number().int().nullable(),
  venue: z.string().default(''),
  venueAbbreviation: z.string().default('misc'),
  doi: z.string().nullable(),
  citationKey: z.string(),
  authors: z.array(Author),
  publisher: z.string().default(''),
  publicationPlace: z.string().default(''),
  publicationDate: z.string().default(''),
  volume: z.string().default(''),
  issue: z.string().default(''),
  pages: z.string().default(''),
  affiliations: z.array(z.object({ name: z.string(), place: z.string().default('') })).default([]),
  salientContribution: z.string().default(''),
  recordKind: z.enum(['scholarly_record', 'demo_fixture']).default('scholarly_record'),
  verificationStatus: VerificationStatus,
  manifestationType: z.string().default('version_of_record'),
  accessClass: z.string().default('metadata_only'),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Work = z.infer<typeof Work>;

export const DiscoverySeed = z.object({
  mode: z.enum(['topic', 'papers']), topic: z.string().trim().max(500).default(''),
  workIds: z.array(z.string().uuid()).max(10).default([]),
  timezone: z.string().default('America/New_York').refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Use an IANA timezone'),
  hour: z.number().int().min(0).max(23).default(7), enabled: z.boolean().default(true)
}).refine(value => value.mode === 'topic' ? value.topic.length >= 2 : value.workIds.length > 0,
  'Provide a topic or at least one seed paper');
export type DiscoverySeed = z.infer<typeof DiscoverySeed>;
export interface FirstPass {
  status: 'full_text' | 'partial_full_text' | 'abstract_only' | 'needs_evidence' | 'needs_model';
  category: string; context: string; correctness: string; contributions: string; clarity: string;
  novelty: string; comparedWorkIds: string[];
  evidence: Array<{ workId: string; section: string; quote: string }>;
  coverage: string[]; limitations: string[]; provider: string; createdAt: string;
}
export type CollectionWork = Work & { isNew: boolean; status: WorkStatus; firstPass?: FirstPass };

export const Collection = z.object({
  id: z.string(), name: z.string(), description: z.string().default(''),
  parentId: z.string().nullable(), memberCount: z.number().int().default(0),
  newCount: z.number().int().optional(), discovery: DiscoverySeed.nullable().optional(),
  nextDiscoveryAt: z.string().nullable().optional(), lastDiscoveryAt: z.string().nullable().optional(), discoveryError: z.string().nullable().optional(),
  createdAt: z.string(), updatedAt: z.string()
});
export type Collection = z.infer<typeof Collection>;

export const RelationshipPredicate = z.enum([
  'semantically_similar', 'cites', 'cited_by', 'co_cited', 'bibliographic_coupling',
  'uses_as_baseline', 'compares_against', 'evaluates_on', 'uses_method', 'extends', 'contradicts'
]);
export type RelationshipPredicate = z.infer<typeof RelationshipPredicate>;

export interface Relationship {
  id: string; sourceId: string; targetId: string; predicate: RelationshipPredicate;
  confidence: number; verificationStatus: 'inferred' | 'verified' | 'rejected';
  evidence?: { exactText: string; page?: number; section?: string }[];
}

export interface SearchResult {
  work: Work;
  rank: number;
  score: number;
  features: Record<string, number>;
  whyShown: string[];
}

export interface GraphProjection {
  nodes: Array<{ id: string; label: string; year: number | null; venue: string; gist: string; status?: WorkStatus; cluster?: string }>;
  edges: Relationship[];
  truncated: boolean;
}

export interface AnswerClaim {
  id: string; text: string; supportStatus: 'directly_supported' | 'indirectly_supported' | 'unsupported' | 'inferred';
  evidence: Array<{ type: string; sourceId: string; label: string; exactText?: string }>;
}

export interface Answer {
  id: string; status: 'complete' | 'insufficient_evidence'; markdown: string;
  claims: AnswerClaim[]; limitations: string[];
  modelProvenance: Record<string, unknown>; createdAt: string;
}

export interface Job { id: string; type: string; state: string; progress: number; result?: unknown; error?: string; createdAt: string; updatedAt: string }

export const citationKey = (family: string, venue: string, year: number, suffix = '') => {
  const author = family.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase() || 'anon';
  const abbreviation = venue.toLowerCase().replace(/[^a-z0-9]/g, '') || 'misc';
  return `${author}-${abbreviation}${String(year).slice(-2)}${suffix}`;
};
