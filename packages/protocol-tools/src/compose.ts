import type { Protocol, ProtocolStep } from '@assessment-kit/types';

/**
 * Solution-first composition (strategic decision 7): a catalog's step library
 * plus one solution's `requires` compose into an executable Protocol — the
 * shooting script is base module + the solution's required steps,
 * deduplicated, in library order. Runs on validated catalog documents
 * (`validateCatalog` first); throws on unknown solution/step ids.
 */

interface LibraryStep {
  id: string;
  captureType: ProtocolStep['captureType'];
  title: string;
  guidance?: string;
  captureSpec?: Record<string, unknown>;
  overlayRef?: string;
  exampleRef?: string;
  feedsAnalyzers?: string[];
  validationRules?: Record<string, unknown>;
  optional?: boolean;
  conditional?: string;
}

interface CatalogDoc {
  catalog: {
    id: string;
    version: string;
    subjectType: string;
    refinementPolicy?: { maxRefinementRounds: number };
  };
  stepLibrary: { base: LibraryStep[]; shared?: LibraryStep[] };
  solutions: Array<{ id: string; requires: string[] }>;
}

export interface ComposeOptions {
  /** Roles used when a library step declares none. Default: ['general-review']. */
  defaultAnalyzerRoles?: string[];
  /** Overrides the catalog's refinementPolicy (default 2 rounds). */
  maxRefinementRounds?: number;
}

export function composeProtocol(
  catalogDoc: unknown,
  solutionId: string,
  options: ComposeOptions = {},
): Protocol {
  const doc = catalogDoc as CatalogDoc;
  const solution = doc.solutions.find((s) => s.id === solutionId);
  if (!solution) {
    throw new Error(`solution "${solutionId}" not found in catalog "${doc.catalog.id}"`);
  }

  const shared = new Map((doc.stepLibrary.shared ?? []).map((s) => [s.id, s]));
  const baseIds = new Set(doc.stepLibrary.base.map((s) => s.id));

  const steps: LibraryStep[] = [...doc.stepLibrary.base];
  for (const stepId of solution.requires) {
    if (baseIds.has(stepId)) continue; // already captured by the base module
    const step = shared.get(stepId);
    if (!step) {
      throw new Error(
        `solution "${solutionId}" requires unknown step "${stepId}" (not in stepLibrary)`,
      );
    }
    if (!steps.some((s) => s.id === stepId)) steps.push(step);
  }

  return {
    id: `${doc.catalog.id}--${solutionId}`,
    version: doc.catalog.version,
    subjectType: doc.catalog.subjectType,
    refinementPolicy: {
      maxRefinementRounds:
        options.maxRefinementRounds ?? doc.catalog.refinementPolicy?.maxRefinementRounds ?? 2,
      skippable: true,
    },
    steps: steps.map((s) => toProtocolStep(s, options)),
  };
}

function toProtocolStep(step: LibraryStep, options: ComposeOptions): ProtocolStep {
  return {
    id: step.id,
    title: step.title,
    guidance: step.guidance ?? step.title,
    captureType: step.captureType,
    captureSpec: step.captureSpec ?? {},
    overlayRef: step.overlayRef,
    exampleRef: step.exampleRef,
    feedsAnalyzers: step.feedsAnalyzers ?? options.defaultAnalyzerRoles ?? ['general-review'],
    validationRules: step.validationRules,
    optional: step.optional,
    condition: step.conditional,
  };
}

/**
 * Subject-compatibility predicates (catalog `solution.compatibility`):
 * simple attribute checks — `eq`, `in`, `gte`, `lte`. A solution with no
 * predicates is compatible with every subject. Unknown attributes fail the
 * predicate (conservative: don't offer what we can't verify).
 */
export interface CompatibilityRule {
  attribute: string;
  op: 'eq' | 'in' | 'gte' | 'lte';
  value: unknown;
}

export function isCompatible(
  solution: { compatibility?: CompatibilityRule[] },
  subjectAttributes: Record<string, unknown>,
): boolean {
  return (solution.compatibility ?? []).every((rule) => {
    const actual = subjectAttributes[rule.attribute];
    if (actual === undefined || actual === null) return false;
    switch (rule.op) {
      case 'eq':
        return actual === rule.value;
      case 'in':
        return Array.isArray(rule.value) && rule.value.includes(actual);
      case 'gte':
        return typeof actual === 'number' && typeof rule.value === 'number' && actual >= rule.value;
      case 'lte':
        return typeof actual === 'number' && typeof rule.value === 'number' && actual <= rule.value;
      default:
        return false;
    }
  });
}
