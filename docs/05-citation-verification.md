# VANI 0.1 Citation Verification and Export

## 1. Reliability rule

An LLM may propose identifiers, record matches, venue aliases, or field corrections. It may not directly create a verified field or citation. Verification is based on source assertions, deterministic normalization, authority rules, and user decisions.

## 2. Core fields

A manifestation cannot reach `verified_multi_source` without:

- title;
- ordered authors or explicit organizational author;
- publication type;
- publication year;
- venue/publisher where applicable;
- primary persistent identifier where one exists.

Publication-specific fields such as volume, issue, pages, article number, event, and DOI are verified when present.

## 3. Verification process

1. Validate and resolve persistent identifiers.
2. Retrieve the authoritative record for the publication type.
3. Retrieve at least one independent corroborating record when available.
4. Normalize values without discarding raw forms.
5. Compare fields using field-specific equivalence rules.
6. Select canonical assertions using source authority and completeness.
7. surface material conflicts.
8. Record the decision and rule version.

Verification states:

```text
verified_authoritative
verified_multi_source
verified_with_minor_differences
provisional
conflicting_metadata
incomplete
user_corrected
superseded
```

## 4. Equivalence rules

### DOI

- strip resolver prefixes and surrounding whitespace;
- compare case-insensitively;
- resolve through the DOI system;
- preserve registered and originally supplied forms;
- reject a DOI whose resolved title/author evidence is incompatible with the candidate.

### Title

- normalize Unicode and whitespace for comparison;
- treat dash and punctuation variants as minor differences;
- preserve original capitalization and symbols from the authoritative record;
- require human review for meaningful word changes.

### Authors

- compare structured family/given names and order;
- tolerate initials versus full given names when family names and order align;
- use ORCID as strong corroboration, not a replacement for name checks;
- treat missing, added, or reordered authors as material conflicts.

### Dates

Keep submitted, accepted, public, online, issued, and print dates independently. The citation year defaults to the issued year of the cited manifestation.

### Pages and article numbers

- preserve literal source values;
- normalize hyphen/en-dash page ranges internally;
- export BibTeX page ranges with `--`;
- do not convert an article number into a page range.

## 5. Citation-key algorithm

Default template:

```text
{firstAuthor.family:slug}-{venue.abbreviation}{issued.year:2}
```

Algorithm:

1. Use the structured family name of the first author.
2. Unicode-normalize and transliterate for an ASCII key.
3. Lowercase and remove whitespace, punctuation, apostrophes, and hyphens.
4. Resolve the canonical venue abbreviation from the venue registry.
5. Use the final two digits of the cited manifestation's issued year.
6. If the key exists for another manifestation, append `a`, `b`, ... in persisted assignment order.
7. Freeze the key after export or explicit user action.
8. Preserve previous keys as aliases after an approved rename.

Examples:

```text
Meshram + IEEE Robotics and Automation Letters + 2026 → meshram-ral26
García + ICRA + 2025 → garcia-icra25
Van der Waals + IJRR + 2024 → vanderwaals-ijrr24
```

Preprints and published versions remain distinct:

```text
meshram-arxiv26
meshram-ral26
```

## 6. Venue abbreviation governance

- `spec/venue-abbreviations.yaml` seeds a database registry.
- Each venue has one canonical abbreviation and any number of aliases.
- User edits are versioned.
- Ambiguous aliases require venue identity context.
- Venue abbreviation changes do not mutate frozen citation keys.
- Imports may propose aliases but cannot silently change the registry.

## 7. Export formats

The internal canonical record is a superset of export formats. Generate:

- BibTeX for compatibility;
- BibLaTeX for richer LaTeX metadata;
- CSL-JSON for citation processors;
- RIS for reference-manager interchange;
- lossless VANI JSON including provenance and relations.

## 8. Collection export

Inputs:

- collection ID;
- recursive descendants flag;
- selected or all works;
- preferred manifestation policy;
- format;
- verification threshold;
- include abstract/keywords/files flags;
- Unicode versus LaTeX escaping;
- key-template override.

Procedure:

1. Materialize a stable collection snapshot.
2. Deduplicate works and manifestations.
3. Apply preferred-version policy.
4. Validate records and keys.
5. Produce deterministic ordered entries.
6. Write export and a machine-readable manifest.
7. Record export hash, configuration, snapshot, and citation-key freeze.

Default preferred-version policy:

```text
version_of_record > journal_version > proceedings_version
> accepted_manuscript > preprint > submission
```

Do not silently drop a preprint when it contains distinct collection annotations or the user explicitly selected it.

## 9. Pre-export validation

Blocking errors:

- duplicate citation keys;
- invalid entry syntax;
- missing title;
- missing author/organization;
- missing year;
- unresolved identity collision;
- selected manifestation has been merged into another without review.

Warnings:

- provisional or conflicting fields;
- no persistent identifier;
- preprint selected when a verified version of record exists;
- corrected or retracted work;
- missing venue details;
- local file paths included in a portable export.

The user may export warnings after explicit acknowledgement. Retractions are never silently excluded.

## 10. BibTeX normalization

- Protect title acronyms and proper capitalization with braces when required.
- Escape reserved LaTeX characters in escape mode.
- Use `--` for page ranges and typographic dashes as appropriate.
- Export authors as `Family, Given and Family, Given`.
- Include DOI and canonical DOI URL.
- Retain non-standard rich fields only when the selected target supports them.
- Do not stuff unsupported provenance into `note` fields.

Reference example:

```bibtex
@article{meshram-ral26,
  author    = {Meshram, Pranay and Adhivarahan, Charuvahan and
               Esfahani, Ehsan Tarkesh and Chowdhury, Souma and
               Wang, Chen and Dantu, Karthik},
  title     = {{CLEAR}: A Semantic--Geometric Terrain Abstraction
               for Large-Scale Unstructured Environments},
  journal   = {IEEE Robotics and Automation Letters},
  year      = {2026},
  month     = oct,
  volume    = {11},
  number    = {10},
  pages     = {11394--11401},
  publisher = {IEEE},
  doi       = {10.1109/LRA.2026.3726338},
  url       = {https://doi.org/10.1109/LRA.2026.3726338}
}
```

## 11. Round-trip tests

Release tests must import each generated format into at least:

- VANI itself;
- Zotero-compatible test tooling or Zotero where automation permits;
- a BibTeX parser;
- Biber/BibLaTeX tooling for BibLaTeX output;
- a CSL processor for CSL-JSON.

The round trip must preserve work identity, title, author order, year, venue, DOI, and citation key. Rich fields that cannot survive a target format are documented in the export manifest.

