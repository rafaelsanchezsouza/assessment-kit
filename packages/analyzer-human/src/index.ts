import type { Analyzer, AnalyzerInput, AnalyzerOutput, AnalyzerRegistration } from '@assessment-kit/types';

/**
 * Human-expert analyzer: enqueues a review task and resolves when the expert
 * submits findings / evidence requests. v1 ships with ONLY this analyzer —
 * AI analyzers slot in later behind the same contract.
 *
 * The pending-review queue is in-memory (keyed by assessment id) — fine for
 * a single-process POC, but it won't survive a server restart. A durable
 * queue is a follow-up, not a blocker for this round.
 */
export class HumanAnalyzer implements Analyzer {
  registration: AnalyzerRegistration = {
    id: 'human-review',
    version: '0.1.0',
    kind: 'human',
    roles: ['*'],
    consumes: ['image', 'structured_input', 'document'],
    async: true,
  };

  private readonly pending = new Map<string, (output: AnalyzerOutput) => void>();

  async analyze(input: AnalyzerInput): Promise<AnalyzerOutput> {
    return new Promise((resolve) => {
      this.pending.set(input.assessment.id, resolve);
    });
  }

  /** Called by the review endpoint when a human submits findings/evidenceRequests. */
  submitReview(assessmentId: string, output: AnalyzerOutput): boolean {
    const resolve = this.pending.get(assessmentId);
    if (!resolve) return false;
    this.pending.delete(assessmentId);
    resolve(output);
    return true;
  }

  hasPendingReview(assessmentId: string): boolean {
    return this.pending.has(assessmentId);
  }
}
