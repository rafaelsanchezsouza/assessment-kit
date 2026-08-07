#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';

import { sniffDocumentKind, validateCatalog, validateProtocol } from './validator.js';

function walkYamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkYamlFiles(full));
    } else if (extname(entry) === '.yaml' || extname(entry) === '.yml') {
      out.push(full);
    }
  }
  return out;
}

function main(argv: string[]): number {
  const [command, ...dirs] = argv;

  if (command !== 'validate' || dirs.length === 0) {
    console.error('Usage: assessment-protocols validate <dir...>');
    return 1;
  }

  let anyFailed = false;
  let filesChecked = 0;

  for (const dirArg of dirs) {
    const dir = resolve(process.cwd(), dirArg);
    for (const file of walkYamlFiles(dir)) {
      filesChecked++;
      const doc = parseYaml(readFileSync(file, 'utf8'));
      const kind = sniffDocumentKind(doc);

      if (kind === 'unknown') {
        console.error(`FAIL ${file}\n  not a recognizable protocol or catalog document`);
        anyFailed = true;
        continue;
      }

      const result =
        kind === 'protocol' ? validateProtocol(doc, dirname(file)) : validateCatalog(doc);

      if (result.valid) {
        console.log(`OK   ${file} (${kind})`);
      } else {
        console.error(`FAIL ${file} (${kind})`);
        for (const err of result.errors) console.error(`  - ${err}`);
        anyFailed = true;
      }
    }
  }

  if (filesChecked === 0) {
    console.error('No .yaml files found in the given directories.');
    return 1;
  }

  return anyFailed ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
