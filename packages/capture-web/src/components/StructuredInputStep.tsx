import { useState } from 'react';
import type { ProtocolStep } from '@gaf/types';
import type { CaptureStrings } from '../i18n.ts';

/**
 * Minimal renderer for `captureType: structured_input` steps, driven by
 * `captureSpec.jsonSchema` (object schema, flat properties): enum → select,
 * boolean → checkbox, number/integer → number input, string → text input.
 * Just enough for capture flows — full form rendering belongs to
 * @gaf/forms-web.
 */

interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
  title?: string;
  description?: string;
}

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

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

  const setAnswer = (key: string, value: unknown) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const missingRequired = [...required].some((key) => answers[key] === undefined || answers[key] === '');

  return (
    <div className={className ?? 'gaf-structured-step'}>
      {Object.entries(properties).map(([key, prop]) => (
        <label key={key} className="gaf-field" style={{ display: 'block', marginBottom: '0.75rem' }}>
          <span className="gaf-field-label" style={{ display: 'block', marginBottom: '0.25rem' }}>
            {prop.title ?? key}
            {required.has(key) ? ' *' : ''}
          </span>
          {renderInput(key, prop, answers[key], setAnswer)}
          {prop.description ? <small style={{ display: 'block' }}>{prop.description}</small> : null}
        </label>
      ))}
      <div className="gaf-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
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
  if (prop.type === 'boolean') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(e) => setAnswer(key, e.target.checked)} />;
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
