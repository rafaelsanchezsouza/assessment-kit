// Clone-and-run demo: loads the demo protocol, wires the Postgres storage
// adapter + HumanAnalyzer + Orchestrator into @gaf/core's HTTP API, and
// starts listening. Run `pnpm --filter @gaf/storage-postgres migrate`
// against a running Postgres (see its docker-compose.yml) before starting.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HumanAnalyzer } from '@gaf/analyzer-human';
import { createApp, Orchestrator } from '@gaf/core';
import { validateProtocol } from '@gaf/protocol-tools';
import { createPostgresStorage, FsBlobStore, getPool } from '@gaf/storage-postgres';
import type { Protocol } from '@gaf/types';
import { load as parseYaml } from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const protocolPath = resolve(here, '../../../protocols/demo/backyard-quick-check.yaml');

async function main(): Promise<void> {
  const doc = parseYaml(readFileSync(protocolPath, 'utf8'));
  const { valid, errors } = validateProtocol(doc, dirname(protocolPath));
  if (!valid) {
    console.error(`invalid demo protocol at ${protocolPath}:`, errors);
    process.exit(1);
  }
  const protocol = doc as Protocol;

  const pool = getPool();
  const storage = createPostgresStorage(pool);
  await storage.protocols.save(protocol);

  const humanAnalyzer = new HumanAnalyzer();
  const orchestrator = new Orchestrator({
    findingRepository: storage.findings,
    evidenceRequestRepository: storage.evidenceRequests,
    assessmentRepository: storage.assessments,
  });
  orchestrator.register(humanAnalyzer);

  const app = createApp({
    subjects: storage.subjects,
    protocols: storage.protocols,
    assessments: storage.assessments,
    evidence: storage.evidence,
    findings: storage.findings,
    evidenceRequests: storage.evidenceRequests,
    orchestrator,
    reviewSubmitter: humanAnalyzer,
    blobs: new FsBlobStore(process.env.BLOB_DIR ?? './blobs'),
  });

  const port = Number(process.env.PORT ?? 3002);
  app.listen(port, () => {
    console.log(`@gaf/reference-app listening on http://localhost:${port}`);
    console.log(`demo protocol loaded: ${protocol.id}@${protocol.version}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
