import type { WorkInput } from './repository.js';
import { cleanDoi } from './lib/citations.js';

export interface Candidate extends WorkInput { connector: string; externalId: string; sourcePayload: unknown }

const reconstructAbstract = (index?: Record<string, number[]>) => {
  if (!index) return '';
  return Object.entries(index).flatMap(([word, positions]) => positions.map((position) => ({ word, position })))
    .sort((a, b) => a.position - b.position).map((item) => item.word).join(' ');
};

export async function searchOpenAlex(term: string, email = '', limit = 12): Promise<Candidate[]> {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', term); url.searchParams.set('per-page', String(limit));
  if (email) url.searchParams.set('mailto', email);
  const response = await fetch(url, { headers: { 'User-Agent': `VANI/0.1${email ? ` (mailto:${email})` : ''}` }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);
  const data: any = await response.json();
  return (data.results ?? []).map((item: any) => ({ title: item.title, abstract: reconstructAbstract(item.abstract_inverted_index), year: item.publication_year,
    venue: item.primary_location?.source?.display_name ?? item.type_crossref ?? 'Unknown venue', doi: cleanDoi(item.doi),
    authors: (item.authorships ?? []).map((authorship: any) => { const parts = String(authorship.author?.display_name ?? '').trim().split(/\s+/); return { given: parts.slice(0,-1).join(' '), family: parts.at(-1) ?? 'Unknown', orcid: authorship.author?.orcid }; }),
    verificationStatus: item.doi ? 'partial' : 'unverified', accessClass: item.open_access?.is_oa ? 'open_access' : 'metadata_only',
    publisher: item.primary_location?.source?.host_organization_name ?? '', publicationDate: item.publication_date ?? '',
    salientContribution: reconstructAbstract(item.abstract_inverted_index).split(/(?<=[.!?])\s/)[0] ?? '',
    connector: 'openalex', externalId: item.id, sourcePayload: item }));
}

export async function searchCrossref(term: string, limit = 8): Promise<Candidate[]> {
  const url = new URL('https://api.crossref.org/works'); url.searchParams.set('query.bibliographic', term); url.searchParams.set('rows', String(limit));
  url.searchParams.set('select', 'DOI,title,author,published,container-title,abstract,type,URL');
  const response = await fetch(url, { headers: { 'User-Agent': 'VANI/0.1 (research discovery)' }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Crossref returned ${response.status}`);
  const data: any = await response.json();
  return (data.message?.items ?? []).map((item: any) => ({ title: item.title?.[0] ?? 'Untitled', abstract: String(item.abstract ?? '').replace(/<[^>]+>/g, ' '),
    year: item.published?.['date-parts']?.[0]?.[0] ?? null, venue: item['container-title']?.[0] ?? 'Unknown venue', doi: cleanDoi(item.DOI),
    authors: (item.author ?? []).map((author: any) => ({ given: author.given ?? '', family: author.family ?? 'Unknown', orcid: author.ORCID })),
    verificationStatus: 'partial', publisher: item.publisher ?? '', volume: item.volume ?? '', issue: item.issue ?? '', pages: item.page ?? '',
    publicationDate: item.published?.['date-parts']?.[0]?.join('-') ?? '', affiliations: (item.author ?? []).flatMap((author:any)=>author.affiliation??[]).map((aff:any)=>({name:aff.name,place:aff.place?.join(', ')??''})),
    salientContribution: String(item.abstract ?? '').replace(/<[^>]+>/g, ' ').split(/(?<=[.!?])\s/)[0] ?? '',
    connector: 'crossref', externalId: item.DOI ?? item.URL, sourcePayload: item }));
}

export async function discover(term: string, sources: string[], email = '') {
  const tasks: Promise<Candidate[]>[] = [];
  if (sources.includes('openalex')) tasks.push(searchOpenAlex(term, email));
  if (sources.includes('crossref')) tasks.push(searchCrossref(term));
  const settled = await Promise.allSettled(tasks);
  const candidates = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const seen = new Set<string>();
  return candidates.filter((candidate) => { const key = candidate.doi ?? candidate.title.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}
