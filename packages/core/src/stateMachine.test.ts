import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssessmentState } from '@assessment-kit/types';
import { canTransition } from './stateMachine.ts';

// Legal edges per docs/domain-model.md §4.
const legal: [AssessmentState, AssessmentState][] = [
  ['draft', 'capturing'],
  ['draft', 'abandoned'],
  ['capturing', 'analyzing'],
  ['capturing', 'abandoned'],
  ['analyzing', 'awaiting_evidence'],
  ['analyzing', 'review'],
  ['analyzing', 'completed'],
  ['analyzing', 'abandoned'],
  ['awaiting_evidence', 'capturing'],
  ['awaiting_evidence', 'analyzing'],
  ['awaiting_evidence', 'abandoned'],
  ['review', 'analyzing'],
  ['review', 'completed'],
  ['review', 'abandoned'],
];

test('legal transitions are allowed', () => {
  for (const [from, to] of legal) {
    assert.ok(canTransition(from, to), `expected ${from} -> ${to} to be legal`);
  }
});

// A representative sample of edges the domain model forbids.
const illegal: [AssessmentState, AssessmentState][] = [
  ['completed', 'capturing'],
  ['completed', 'analyzing'],
  ['abandoned', 'draft'],
  ['draft', 'analyzing'],
  ['draft', 'completed'],
  ['capturing', 'review'],
  ['capturing', 'completed'],
  ['awaiting_evidence', 'review'],
  ['review', 'capturing'],
];

test('illegal transitions are rejected', () => {
  for (const [from, to] of illegal) {
    assert.ok(!canTransition(from, to), `expected ${from} -> ${to} to be illegal`);
  }
});

test('completed and abandoned are terminal (no outgoing transitions)', () => {
  const allStates: AssessmentState[] = [
    'draft',
    'capturing',
    'analyzing',
    'awaiting_evidence',
    'review',
    'completed',
    'abandoned',
  ];
  for (const to of allStates) {
    assert.ok(!canTransition('completed', to), `completed -> ${to} should be illegal`);
    assert.ok(!canTransition('abandoned', to), `abandoned -> ${to} should be illegal`);
  }
});

test('any state can reach abandoned (except terminal states)', () => {
  const nonTerminal: AssessmentState[] = [
    'draft',
    'capturing',
    'analyzing',
    'awaiting_evidence',
    'review',
  ];
  for (const from of nonTerminal) {
    assert.ok(canTransition(from, 'abandoned'), `${from} -> abandoned should be legal`);
  }
});
