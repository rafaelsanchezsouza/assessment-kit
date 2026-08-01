/**
 * Pure answer bookkeeping for `structured_input` steps — kept out of the React
 * component so it can be unit-tested without a DOM.
 */

export interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
  title?: string;
  description?: string;
}

export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * `false` is an answer; `undefined` and `''` are not. This distinction only
 * holds because booleans render as an explicit yes/no pair — with a lone
 * checkbox, "no" and "not answered" collapse into the same `false`.
 */
export function isAnswered(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** Required keys of `schema` still unanswered in `answers`, in schema order. */
export function missingRequiredKeys(schema: JsonSchemaObject, answers: Record<string, unknown>): string[] {
  return (schema.required ?? []).filter((key) => !isAnswered(answers[key]));
}
