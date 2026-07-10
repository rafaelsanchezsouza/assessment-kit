import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { load as parseYaml } from 'js-yaml';
import { composeProtocol, isCompatible } from './compose.ts';
import { validateCatalog, validateProtocol } from './validator.ts';

const demoCatalog = parseYaml(
  readFileSync(resolve(import.meta.dirname, '../../../catalog/nbs-paraiba.yaml'), 'utf8'),
) as { solutions: Array<{ id: string; requires: string[] }>; stepLibrary: { base: unknown[] } };

test('composeProtocol: base + requires, deduplicated, valid against the protocol schema', () => {
  const solution = demoCatalog.solutions[0];
  const protocol = composeProtocol(demoCatalog, solution.id);

  assert.ok(protocol.id.endsWith(`--${solution.id}`));
  // base steps come first
  const baseCount = demoCatalog.stepLibrary.base.length;
  const stepIds = protocol.steps.map((s) => s.id);
  assert.equal(new Set(stepIds).size, stepIds.length, 'no duplicate steps');
  assert.ok(stepIds.length >= baseCount);
  for (const required of solution.requires) {
    assert.ok(stepIds.includes(required), `required step ${required} present`);
  }
  // every composed step is executable (guidance defaulted, roles defaulted)
  for (const step of protocol.steps) {
    assert.ok(step.guidance.length > 0);
    assert.ok(step.feedsAnalyzers.length > 0);
  }
  // the composed document passes the protocol schema end to end
  const result = validateProtocol(protocol, import.meta.dirname);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('composeProtocol: unknown solution and dangling requires throw', () => {
  assert.throws(() => composeProtocol(demoCatalog, 'nao-existe'), /not found/);
  const broken = structuredClone(demoCatalog) as typeof demoCatalog;
  broken.solutions[0].requires = ['passo-fantasma'];
  assert.throws(() => composeProtocol(broken, broken.solutions[0].id), /unknown step/);
});

test('composeProtocol: refinement policy from options > catalog > default', () => {
  const solution = demoCatalog.solutions[0].id;
  assert.equal(composeProtocol(demoCatalog, solution).refinementPolicy.maxRefinementRounds, 2);
  assert.equal(
    composeProtocol(demoCatalog, solution, { maxRefinementRounds: 5 }).refinementPolicy
      .maxRefinementRounds,
    5,
  );
});

test('extended catalog fields (guidance, compatibility, metadata) pass validation', () => {
  const doc = {
    catalog: {
      id: 'test-cat',
      version: '0.1.0',
      subjectType: 'building',
      refinementPolicy: { maxRefinementRounds: 3 },
    },
    stepLibrary: {
      base: [
        {
          id: 'context',
          captureType: 'structured_input',
          title: 'Context',
          guidance: 'Tell us about the place',
          captureSpec: { jsonSchema: { type: 'object' } },
        },
      ],
      shared: [
        {
          id: 'roof',
          captureType: 'image',
          title: 'Roof',
          validationRules: { maxBlur: 0.4 },
          optional: true,
          feedsAnalyzers: ['roof-review'],
        },
      ],
    },
    solutions: [
      {
        id: 'rainwater',
        title: 'Rainwater harvesting',
        category: 'water',
        fulfillmentType: 'service',
        conditionsAddressed: ['water-scarcity'],
        requires: ['roof'],
        compatibility: [
          { attribute: 'type', op: 'in', value: ['house', 'commercial'] },
          { attribute: 'builtArea', op: 'gte', value: 50 },
        ],
        metadata: { estimate: { min: 1000, max: 5000 } },
      },
    ],
  };
  const result = validateCatalog(doc);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);

  const protocol = composeProtocol(doc, 'rainwater');
  assert.deepEqual(
    protocol.steps.map((s) => s.id),
    ['context', 'roof'],
  );
  assert.equal(protocol.steps[1].feedsAnalyzers[0], 'roof-review');
  assert.equal(protocol.refinementPolicy.maxRefinementRounds, 3);
});

test('isCompatible: predicates over subject attributes, conservative on missing', () => {
  const solution = {
    compatibility: [
      { attribute: 'type', op: 'in' as const, value: ['house'] },
      { attribute: 'builtArea', op: 'gte' as const, value: 50 },
    ],
  };
  assert.equal(isCompatible(solution, { type: 'house', builtArea: 80 }), true);
  assert.equal(isCompatible(solution, { type: 'apartment', builtArea: 80 }), false);
  assert.equal(isCompatible(solution, { type: 'house', builtArea: 40 }), false);
  assert.equal(isCompatible(solution, { type: 'house' }), false, 'missing attribute fails');
  assert.equal(isCompatible({}, {}), true, 'no rules = compatible');
});
