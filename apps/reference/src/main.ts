// Clone-and-run composition root: loads protocols, wires the Postgres storage
// adapter + HumanAnalyzer + Orchestrator into @gaf/core's HTTP API, and
// starts listening. Run `pnpm --filter @gaf/storage-postgres migrate`
// against a running Postgres (see its docker-compose.yml) before starting.
//
// PROTOCOLS_DIR (colon-separated list of directories) points at the protocol
// YAML to serve — this is how a vertical runs the same server against its own
// private protocols without any code change. Defaults to the repo's demo dir.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HumanAnalyzer } from '@gaf/analyzer-human';
import { createApp, Orchestrator } from '@gaf/core';
import { validateProtocol } from '@gaf/protocol-tools';
import { createPostgresStorage, FsBlobStore, getPool } from '@gaf/storage-postgres';
import type { Protocol } from '@gaf/types';
import { load as parseYaml } from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const defaultProtocolDir = resolve(here, '../../../protocols/demo');
const protocolDirs = (process.env.PROTOCOLS_DIR ?? defaultProtocolDir)
  .split(':')
  .filter(Boolean)
  .map((dir) => resolve(dir));

function loadProtocols(): Protocol[] {
  const protocols: Protocol[] = [];
  for (const dir of protocolDirs) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      const path = resolve(dir, file);
      const doc = parseYaml(readFileSync(path, 'utf8'));
      const { valid, errors } = validateProtocol(doc, dir);
      if (!valid) {
        console.error(`invalid protocol at ${path}:`, errors);
        process.exit(1);
      }
      protocols.push(doc as Protocol);
    }
  }
  if (protocols.length === 0) {
    console.error(`no protocol YAML found in: ${protocolDirs.join(', ')}`);
    process.exit(1);
  }
  return protocols;
}

async function main(): Promise<void> {
  const protocols = loadProtocols();

  const pool = getPool();
  const storage = createPostgresStorage(pool);
  for (const protocol of protocols) {
    await storage.protocols.save(protocol);
  }

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
    for (const p of protocols) console.log(`protocol loaded: ${p.id}@${p.version}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
