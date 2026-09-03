import { Repository } from '../repository.js';
import { migrate } from './migrate.js';

const repository = new Repository();

async function seed() {
  await migrate();
  const collections = await repository.listCollections();
  const collection = collections.find((item) => item.name === 'Terrain Intelligence') ?? await repository.createCollection({ name: 'Terrain Intelligence', description: 'Semantic and geometric representations for robot navigation.' });
  const samples = [
    { title: 'CLEAR: A Semantic–Geometric Terrain Abstraction for Large-Scale Unstructured Environments', year: 2026, venue: 'IEEE Robotics and Automation Letters', doi: '10.1109/LRA.2026.3726338',
      authors: [{given:'Pranay',family:'Meshram'},{given:'Charuvahan',family:'Adhivarahan'},{given:'Ehsan Tarkesh',family:'Esfahani'},{given:'Souma',family:'Chowdhury'},{given:'Chen',family:'Wang'},{given:'Karthik',family:'Dantu'}],
      abstract: 'CLEAR combines semantic and geometric information into a scalable terrain abstraction intended for motion planning in large unstructured environments. The representation is evaluated through planning-oriented experiments.', verificationStatus: 'verified_multi_source' as const },
    { title: 'Learning Semantic Terrain Representations for Long-Horizon Navigation', year: 2024, venue: 'IEEE International Conference on Robotics and Automation', authors: [{given:'Mira',family:'Chen'}],
      abstract: 'This study learns a compact representation of terrain semantics for long-horizon robot navigation and evaluates generalization across outdoor sites.', verificationStatus: 'unverified' as const },
    { title: 'Geometric Cost Maps for Unstructured Field Robotics', year: 2023, venue: 'IEEE/RSJ International Conference on Intelligent Robots and Systems', authors: [{given:'A.',family:'Patel'}],
      abstract: 'A geometry-first cost-map pipeline estimates traversability from local surface shape and uses the map in a sampling-based planner.', verificationStatus: 'unverified' as const },
    { title: 'Benchmarking Terrain-Aware Planning Under Perceptual Uncertainty', year: 2025, venue: 'Robotics: Science and Systems', authors: [{given:'Lina',family:'Okafor'}],
      abstract: 'The benchmark compares terrain-aware planners under controlled perception noise, reporting safety, path efficiency, and compute cost.', verificationStatus: 'unverified' as const },
    { title: 'Open-World Semantic Mapping for Mobile Robots', year: 2022, venue: 'Conference on Robot Learning', authors: [{given:'Jon',family:'Rivera'}],
      abstract: 'An open-world semantic mapping system incrementally introduces new terrain categories and preserves uncertainty for downstream navigation.', verificationStatus: 'unverified' as const },
    { title: 'Multi-Resolution World Models for Kilometer-Scale Autonomy', year: 2025, venue: 'IEEE Robotics and Automation Letters', authors: [{given:'Sara',family:'Kim'}],
      abstract: 'A multi-resolution world model balances local geometric detail with global semantic context for kilometer-scale autonomous missions.', verificationStatus: 'unverified' as const }
  ];
  const works = [];
  for (const sample of samples) works.push(await repository.createWork(sample));
  await repository.addToCollection(collection.id, works.map((work) => work.id));
  const edgeData = [
    [1,0,'semantically_similar',0.91],[2,0,'compares_against',0.72],[0,3,'evaluates_on',0.76],[4,0,'uses_method',0.64],[5,0,'semantically_similar',0.84],[2,3,'uses_as_baseline',0.68],[1,4,'extends',0.61]
  ] as const;
  for (const [source,target,predicate,confidence] of edgeData) await repository.createRelationship({ sourceId: works[source]!.id, targetId: works[target]!.id, predicate, confidence,
    verificationStatus: predicate === 'semantically_similar' ? 'inferred' : 'verified', evidence: predicate === 'semantically_similar' ? [] : [{ exactText: 'Demo evidence passage. Replace with a verified PDF span during ingestion.', section: 'Experiments' }] });
  await repository.createNote({ title: 'Terrain abstraction synthesis', markdown: 'Compare the scale at which geometric detail is discarded and identify the planning decisions each representation preserves.', noteType: 'synthesis', collectionId: collection.id });
  console.log(`Seeded ${works.length} works in “${collection.name}”.`);
}

seed().then(() => repository.close()).catch((error) => { console.error(error); process.exitCode = 1; });
