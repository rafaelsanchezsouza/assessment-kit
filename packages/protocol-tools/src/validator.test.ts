import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import { validateCatalog, validateProtocol } from './validator.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function loadYamlFile(path: string): unknown {
  return parseYaml(readFileSync(path, 'utf8'));
}

test('validateProtocol accepts the real demo protocol', () => {
  const path = resolve(repoRoot, 'protocols/demo/backyard-quick-check.yaml');
  const result = validateProtocol(loadYamlFile(path), dirname(path));
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('validateProtocol rejects a duplicate step id', () => {
  const doc = {
    id: 'broken-protocol',
    version: '0.1.0',
    subjectType: 'backyard',
    refinementPolicy: { maxRefinementRounds: 1 },
    steps: [
      {
        id: 'dup',
        title: 'A',
        guidance: 'a',
        captureType: 'image',
        feedsAnalyzers: ['general-review'],
      },
      {
        id: 'dup',
        title: 'B',
        guidance: 'b',
        captureType: 'image',
        feedsAnalyzers: ['general-review'],
      },
    ],
  };
  const result = validateProtocol(doc, here);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate step id')));
});

test('validateProtocol rejects a condition that references no structured_input step', () => {
  const doc = {
    id: 'broken-protocol',
    version: '0.1.0',
    subjectType: 'backyard',
    refinementPolicy: { maxRefinementRounds: 1 },
    steps: [
      {
        id: 'wide-shot',
        title: 'Wide',
        guidance: 'g',
        captureType: 'image',
        feedsAnalyzers: ['general-review'],
      },
      {
        id: 'follow-up',
        title: 'Follow up',
        guidance: 'g',
        captureType: 'image',
        feedsAnalyzers: ['general-review'],
        condition: 'context.drainageIssues === true',
      },
    ],
  };
  const result = validateProtocol(doc, here);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('does not reference any structured_input step')));
});

test('validateCatalog accepts every demo catalog shipped in the repo', () => {
  const catalogDir = resolve(repoRoot, 'catalog');
  const files = readdirSync(catalogDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  assert.ok(files.length > 0, 'expected at least one demo catalog in catalog/');
  for (const file of files) {
    const result = validateCatalog(loadYamlFile(resolve(catalogDir, file)));
    assert.deepEqual(result.errors, [], `catalog ${file} should have no errors`);
    assert.equal(result.valid, true, `catalog ${file} should be valid`);
  }
});

test('validateCatalog rejects a dangling "requires" reference', () => {
  const doc = {
    catalog: { id: 'test-catalog', version: '0.1.0', subjectType: 'building' },
    stepLibrary: {
      base: [{ id: 'contexto', captureType: 'structured_input', title: 'Contexto' }],
    },
    solutions: [
      {
        id: 'cisterna',
        title: 'Cisterna',
        category: 'agua',
        fulfillmentType: 'service',
        conditionsAddressed: ['escassez-hidrica'],
        requires: ['telhado-que-nao-existe'],
      },
    ],
  };
  const result = validateCatalog(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('unknown step id')));
});
