import { citationKey } from '@vani/shared';

const venueAliases: Record<string, string> = {
  'ieee robotics and automation letters': 'ral', 'ieee ra-l': 'ral', 'ra-l': 'ral',
  'acm transactions on graphics': 'tog', 'computer vision and pattern recognition': 'cvpr',
  'international conference on robotics and automation': 'icra',
  'ieee/rsj international conference on intelligent robots and systems': 'iros',
  'neural information processing systems': 'neurips', 'openreview': 'openreview', 'arxiv': 'arxiv'
};

export const venueAbbreviation = (venue: string) => {
  const normalized = venue.toLowerCase().replace(/\s+/g, ' ').trim();
  if (venueAliases[normalized]) return venueAliases[normalized];
  const stop = new Set(['of', 'the', 'and', 'on', 'for', 'in', 'a', 'an']);
  const words = normalized.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word && !stop.has(word));
  return (words.length > 1 ? words.map((word) => word[0]).join('') : words[0] ?? 'misc').slice(0, 10);
};

export const makeCitationKey = (family: string, venue: string, year: number, suffix = '') =>
  citationKey(family, venueAbbreviation(venue), year, suffix);

export const cleanDoi = (value?: string | null) => {
  if (!value) return null;
  return value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
};

export const normalizeTitle = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export interface BibWork {
  citationKey: string; title: string; authors: Array<{ given: string; family: string }>;
  venue: string; year: number | null; doi: string | null; volume?: string; issue?: string; pages?: string;
}

const tex = (value: string) => value.replace(/[{}]/g, '').replace(/&/g, '\\&');

export const toBibtex = (work: BibWork) => {
  const authors = work.authors.map((author) => `${author.family}, ${author.given}`.trim().replace(/,\s*$/, '')).join(' and ');
  const fields = [
    `  author = {${tex(authors)}},`, `  title = {${tex(work.title)}},`, `  journal = {${tex(work.venue)}},`,
    work.year ? `  year = {${work.year}},` : '', work.volume ? `  volume = {${work.volume}},` : '',
    work.issue ? `  number = {${work.issue}},` : '', work.pages ? `  pages = {${work.pages}},` : '',
    work.doi ? `  doi = {${work.doi}}` : ''
  ].filter(Boolean);
  const last = fields.length - 1;
  fields[last] = fields[last]!.replace(/,$/, '');
  return `@article{${work.citationKey},\n${fields.join('\n')}\n}`;
};
