import type { AssessmentState } from '@gaf/types';

/** Legal transitions of the Assessment state machine (docs/domain-model.md §4). */
export const TRANSITIONS: Record<AssessmentState, AssessmentState[]> = {
  draft: ['capturing', 'abandoned'],
  capturing: ['analyzing', 'abandoned'],
  analyzing: ['awaiting_evidence', 'review', 'completed', 'abandoned'],
  awaiting_evidence: ['capturing', 'analyzing', 'abandoned'], // user adds or skips
  review: ['analyzing', 'completed', 'abandoned'],
  completed: [],
  abandoned: [],
};

export function canTransition(from: AssessmentState, to: AssessmentState): boolean {
  return TRANSITIONS[from].includes(to);
}
