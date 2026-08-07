import { useId, useState } from 'react';
import type { ProtocolStep } from '@assessment-kit/types';
import type { CaptureStrings } from '../i18n.ts';
import { missingRequiredKeys, type JsonSchemaObject, type JsonSchemaProperty } from './structuredAnswers.ts';

/**
 * Minimal renderer for `captureType: structured_input` steps, driven by
 * `captureSpec.jsonSchema` (object schema, flat properties): enum → select,
 * boolean → explicit yes/no pair, number/integer → number input, string → text
 * input. Just enough for capture flows — full form rendering belongs to
 * @assessment-kit/forms-web.
 *
 * Booleans are deliberately NOT a lone checkbox: an unchecked box is
 * indistinguishable from an unanswered question, which silently satisfies
 * `required` with `false` and feeds analyzers a fact nobody stated.
 */

export interface StructuredInputStepProps {
  step: ProtocolStep;
  strings: CaptureStrings;
  onSubmit: (answers: Record<string, unknown>) => void;
  onSkip?: () => void;
  className?: string;
}

export function StructuredInputStep({ step, strings, onSubmit, onSkip, className }: StructuredInputStepProps) {
  const schema = (step.captureSpec?.jsonSchema ?? {}) as JsonSchemaObject;
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  // Radio groups must not collide when two steps/forms share a page.
  const formId = useId();

  const setAnswer = (key: string, value: unknown) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const missingRequired = missingRequiredKeys(schema, answers).length > 0;

  return (
    <div className={className ?? 'ak-structured-step'}>
      {Object.entries(properties).map(([key, prop]) => {
        const label = `${prop.title ?? key}${required.has(key) ? ' *' : ''}`;
        const description = prop.description ? <small style={{ display: 'block' }}>{prop.description}</small> : null;

        // A radio group can't hang off a single <label> — the whole group needs
        // one accessible name, so booleans get a fieldset/legend instead.
        if (prop.type === 'boolean') {
          return (
            <fieldset
              key={key}
              className="ak-field ak-field-boolean"
              style={{ display: 'block', marginBottom: '0.75rem', border: 0, padding: 0 }}
            >
              <legend className="ak-field-label" style={{ marginBottom: '0.25rem', padding: 0 }}>
                {label}
              </legend>
              {renderBoolean(key, answers[key], setAnswer, strings, `${formId}-${key}`)}
              {description}
            </fieldset>
          );
        }

        return (
          <label key={key} className="ak-field" style={{ display: 'block', marginBottom: '0.75rem' }}>
            <span className="ak-field-label" style={{ display: 'block', marginBottom: '0.25rem' }}>
              {label}
            </span>
            {renderInput(key, prop, answers[key], setAnswer)}
            {description}
          </label>
        );
      })}
      <div className="ak-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button type="button" disabled={missingRequired} onClick={() => onSubmit(answers)}>
          {strings.next}
        </button>
        {onSkip ? (
          <button type="button" onClick={onSkip}>
            {strings.skip}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function renderBoolean(
  key: string,
  value: unknown,
  setAnswer: (key: string, value: unknown) => void,
  strings: CaptureStrings,
  groupName: string,
) {
  return (
    <span className="ak-boolean-options" style={{ display: 'inline-flex', gap: '1rem' }}>
      {[true, false].map((option) => (
        <label key={String(option)} className="ak-boolean-option">
          <input
            type="radio"
            name={groupName}
            checked={value === option}
            onChange={() => setAnswer(key, option)}
          />{' '}
          {option ? strings.yes : strings.no}
        </label>
      ))}
    </span>
  );
}

function renderInput(
  key: string,
  prop: JsonSchemaProperty,
  value: unknown,
  setAnswer: (key: string, value: unknown) => void,
) {
  if (Array.isArray(prop.enum)) {
    return (
      <select value={value === undefined ? '' : String(value)} onChange={(e) => setAnswer(key, e.target.value)}>
        <option value="" disabled>
          —
        </option>
        {prop.enum.map((opt) => (
          <option key={String(opt)} value={String(opt)}>
            {String(opt)}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === 'number' || prop.type === 'integer') {
    return (
      <input
        type="number"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => setAnswer(key, e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }
  return (
    <input
      type="text"
      value={value === undefined ? '' : String(value)}
      onChange={(e) => setAnswer(key, e.target.value)}
    />
  );
}
