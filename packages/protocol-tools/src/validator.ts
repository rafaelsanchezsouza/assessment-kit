import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';

// ajv ships a CJS build whose .d.ts uses an ESM `export default`; under
// moduleResolution NodeNext that combination resolves to the module namespace
// type rather than the class, so the constructor is recovered at runtime.
const Ajv2020 = Ajv2020Module as unknown as typeof Ajv2020Module.default;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const schemaDir = resolve(dirname(fileURLToPath(import.meta.url)), '../schema');
const protocolSchema = JSON.parse(readFileSync(resolve(schemaDir, 'protocol.schema.json'), 'utf8'));
const catalogSchema = JSON.parse(readFileSync(resolve(schemaDir, 'catalog.schema.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true });
const validateProtocolSchema = ajv.compile(protocolSchema);
const validateCatalogSchema = ajv.compile(catalogSchema);

/** Sniff whether a parsed YAML document is a Protocol or a solution-first Catalog. */
export function sniffDocumentKind(doc: unknown): 'protocol' | 'catalog' | 'unknown' {
  if (!doc || typeof doc !== 'object') return 'unknown';
  const d = doc as Record<string, unknown>;
  if (Array.isArray(d.steps)) return 'protocol';
  if (d.catalog && Array.isArray(d.solutions)) return 'catalog';
  return 'unknown';
}

interface ProtocolStepLike {
  id: string;
  captureType: string;
  overlayRef?: string;
  exampleRef?: string;
  condition?: string;
}

/**
 * Validates a Protocol document: JSON Schema, then referential checks beyond
 * what the schema can express (unique ids, condition/asset references).
 * `sourceDir` anchors relative overlayRef/exampleRef paths for the assets-present check.
 */
export function validateProtocol(doc: unknown, sourceDir: string): ValidationResult {
  const errors: string[] = [];

  if (!validateProtocolSchema(doc)) {
    for (const err of validateProtocolSchema.errors ?? []) {
      errors.push(`${err.instancePath || '/'} ${err.message ?? 'invalid'}`);
    }
    return { valid: false, errors };
  }

  const steps = (doc as { steps: ProtocolStepLike[] }).steps;

  const seenIds = new Set<string>();
  for (const step of steps) {
    if (seenIds.has(step.id)) {
      errors.push(`duplicate step id: "${step.id}"`);
    }
    seenIds.add(step.id);
  }

  const structuredInputIds = steps
    .filter((s) => s.captureType === 'structured_input')
    .map((s) => s.id);

  for (const step of steps) {
    if (step.condition && !structuredInputIds.some((id) => step.condition!.includes(id))) {
      errors.push(
        `step "${step.id}": condition "${step.condition}" does not reference any structured_input step`,
      );
    }
    for (const assetField of ['overlayRef', 'exampleRef'] as const) {
      const ref = step[assetField];
      if (ref && !existsSync(resolve(sourceDir, ref))) {
        errors.push(`step "${step.id}": ${assetField} "${ref}" not found on disk`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

interface LibraryStepLike {
  id: string;
}

interface SolutionLike {
  id: string;
  requires: string[];
  conditionsAddressed: string[];
}

/** Validates a solution-first Catalog document: JSON Schema, then referential checks. */
export function validateCatalog(doc: unknown): ValidationResult {
  const errors: string[] = [];

  if (!validateCatalogSchema(doc)) {
    for (const err of validateCatalogSchema.errors ?? []) {
      errors.push(`${err.instancePath || '/'} ${err.message ?? 'invalid'}`);
    }
    return { valid: false, errors };
  }

  const d = doc as {
    stepLibrary: { base: LibraryStepLike[]; shared?: LibraryStepLike[] };
    solutions: SolutionLike[];
  };

  const knownStepIds = new Set([
    ...d.stepLibrary.base.map((s) => s.id),
    ...(d.stepLibrary.shared ?? []).map((s) => s.id),
  ]);

  const seenSolutionIds = new Set<string>();
  for (const solution of d.solutions) {
    if (seenSolutionIds.has(solution.id)) {
      errors.push(`duplicate solution id: "${solution.id}"`);
    }
    seenSolutionIds.add(solution.id);

    for (const stepId of solution.requires) {
      if (!knownStepIds.has(stepId)) {
        errors.push(`solution "${solution.id}": requires unknown step id "${stepId}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Package-local dirname helper (ESM has no __dirname). */
export function moduleDir(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}
