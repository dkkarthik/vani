import { describe, expect, it } from 'vitest';
import { citationSuffix, cleanDoi, makeCitationKey, toBibtex, venueAbbreviation } from './citations.js';

describe('citation identity', () => {
  it('generates the frozen CLEAR key', () => {
    expect(makeCitationKey('Meshram', 'IEEE Robotics and Automation Letters', 2026)).toBe('meshram-ral26');
  });
  it('normalizes venue aliases', () => {
    expect(venueAbbreviation('RA-L')).toBe('ral');
    expect(venueAbbreviation('IEEE RA-L')).toBe('ral');
  });
  it('normalizes DOI URLs', () => expect(cleanDoi('https://doi.org/10.1109/LRA.2026.3726338')).toBe('10.1109/lra.2026.3726338'));
  it('emits parseable-looking BibTeX without duplicate trailing separators', () => {
    const value=toBibtex({citationKey:'meshram-ral26',title:'CLEAR',authors:[{given:'Pranay',family:'Meshram'}],venue:'IEEE Robotics and Automation Letters',year:2026,doi:'10.1109/LRA.2026.3726338'});
    expect(value).toContain('@article{meshram-ral26,'); expect(value).toContain('author = {Meshram, Pranay}'); expect(value).toContain('doi = {10.1109/LRA.2026.3726338}\n}');
  });
});

it('allocates valid citation suffixes beyond a large batch collision',()=>{expect([0,1,26,27,52,53,500].map(citationSuffix)).toEqual(['','a','z','aa','az','ba','sf']);});
