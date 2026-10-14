import { SourceDiscoveryService } from '../backend/src/modules/research/source-discovery.service.ts';

async function main() {
  console.log('Testing SourceDiscoveryService...');
  const t0 = Date.now();
  const sources = await SourceDiscoveryService.discoverSources(
    'yputube',
    {
      sourceLimit: 8,
      includeAcademic: true,
      includeGitHub: true,
      includeNews: true,
      depth: 'shallow',
      timeBudgetSeconds: 30,
    }
  );
  console.log(`Discovered ${sources.length} sources in ${Date.now() - t0}ms:`);
  console.log(sources);
}

main().catch(console.error);
