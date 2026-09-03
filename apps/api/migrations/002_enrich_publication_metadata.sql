UPDATE work SET source_metadata = source_metadata || jsonb_build_object(
  'publisher', 'Institute of Electrical and Electronics Engineers (IEEE)',
  'publicationPlace', 'IEEE Xplore (online)',
  'publicationDate', '2026-10',
  'volume', '11',
  'issue', '10',
  'pages', '11394–11401',
  'affiliations', jsonb_build_array(jsonb_build_object('name', 'University at Buffalo', 'place', 'Buffalo, NY, USA')),
  'salientContribution', 'Introduces a scalable abstraction that combines semantic terrain meaning with geometric structure so large unstructured environments remain useful for downstream motion planning.',
  'recordKind', 'scholarly_record',
  'metadataSource', 'Crossref DOI record; citation supplied from IEEE Xplore'
) WHERE lower(doi) = '10.1109/lra.2026.3726338';

UPDATE work SET source_metadata = source_metadata || jsonb_build_object(
  'publisher', 'Demo fixture — no external publication record',
  'publicationPlace', 'Not applicable',
  'publicationDate', coalesce(year::text, ''),
  'salientContribution', CASE title
    WHEN 'Learning Semantic Terrain Representations for Long-Horizon Navigation' THEN 'Explores a compact learned terrain representation intended to preserve semantic cues across long outdoor navigation horizons.'
    WHEN 'Geometric Cost Maps for Unstructured Field Robotics' THEN 'Uses local surface geometry to estimate traversability and directly construct costs for sampling-based planning.'
    WHEN 'Benchmarking Terrain-Aware Planning Under Perceptual Uncertainty' THEN 'Frames a controlled benchmark for comparing planner safety, efficiency, and compute cost as perception noise changes.'
    WHEN 'Open-World Semantic Mapping for Mobile Robots' THEN 'Keeps semantic uncertainty explicit while allowing a robot map to acquire previously unseen terrain categories.'
    WHEN 'Multi-Resolution World Models for Kilometer-Scale Autonomy' THEN 'Balances fine local geometry with broad semantic context through a multi-resolution representation for long-range missions.'
    ELSE abstract
  END,
  'recordKind', 'demo_fixture',
  'metadataSource', 'VANI interaction fixture'
) WHERE doi IS NULL;
