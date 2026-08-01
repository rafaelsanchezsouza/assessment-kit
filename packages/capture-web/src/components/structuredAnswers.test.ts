import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isAnswered, missingRequiredKeys, type JsonSchemaObject } from './structuredAnswers.ts';

const schema: JsonSchemaObject = {
  type: 'object',
  required: ['floods', 'area'],
  properties: {
    floods: { type: 'boolean', title: 'Does it flood?' },
    area: { type: 'number', title: 'Area' },
    notes: { type: 'string', title: 'Notes' },
  },
};

test('an unanswered boolean blocks submission', () => {
  assert.deepEqual(missingRequiredKeys(schema, { area: 12 }), ['floods']);
});

test('answering a boolean "no" satisfies required — false is an answer', () => {
  assert.deepEqual(missingRequiredKeys(schema, { floods: false, area: 12 }), []);
});

test('answering a boolean "yes" satisfies required', () => {
  assert.deepEqual(missingRequiredKeys(schema, { floods: true, area: 12 }), []);
});

test('optional properties never block submission', () => {
  assert.deepEqual(missingRequiredKeys(schema, { floods: true, area: 0 }), []);
});

test('missing keys are reported in schema order', () => {
  assert.deepEqual(missingRequiredKeys(schema, {}), ['floods', 'area']);
});

test('a schema without required is always complete', () => {
  assert.deepEqual(missingRequiredKeys({ properties: { a: {} } }, {}), []);
});

test('isAnswered: empty string and null are not answers, 0 and false are', () => {
  assert.equal(isAnswered(''), false);
  assert.equal(isAnswered(undefined), false);
  assert.equal(isAnswered(null), false);
  assert.equal(isAnswered(0), true);
  assert.equal(isAnswered(false), true);
});
