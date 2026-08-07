import type { EvidenceRequest, EvidenceRequestRepository } from '@assessment-kit/types';

/**
 * Resolution of EvidenceRequests, as one rule in one place.
 *
 * The model (design session 2026-08-05, plan.md): resolution is **optimistic** —
 * evidence arriving at the step a request named is presumed to answer it, and a
 * requester who disagrees re-asks (`kind: 'retake'`) rather than rejecting.
 * `status` therefore records what the *capturer* did, never an analyzer's opinion
 * of the answer's quality, which is why `skipped` is a resolution too: the
 * capturer must never be shown a request they have already acted on.
 *
 * This lives in @assessment-kit/core, not in a storage adapter, because a skip writes no
 * evidence and no link at all — an adapter-level hook would see at most half the
 * rule. Exported from the package root so a host that writes evidence without
 * going through this package's HTTP API can apply the same rule.
 */

/** Pending requests this step would answer. Used to resolve them, and to stamp
 *  the resulting evidence link with the right origin. */
export async function findPendingRequestsForStep(
  repo: EvidenceRequestRepository,
  assessmentId: string,
  stepId: string,
): Promise<EvidenceRequest[]> {
  const requests = await repo.findByAssessment(assessmentId);
  return requests.filter((r) => r.status === 'pending' && r.stepSpec.id === stepId);
}

/**
 * Resolves every pending request on `stepId`, not just the oldest: leaving one
 * pending would put the card back on the capturer's screen, which is
 * indistinguishable from the bug this rule fixes.
 *
 * Idempotent — requests that already left `pending` are never rewritten.
 * Returns the ids resolved (a seam for the "your question was answered"
 * notification event, which is deliberately not built yet).
 */
export async function resolveRequestsForStep(
  repo: EvidenceRequestRepository,
  input: { assessmentId: string; stepId: string; outcome: 'done' | 'skipped' },
): Promise<string[]> {
  const pending = await findPendingRequestsForStep(repo, input.assessmentId, input.stepId);
  const status = input.outcome === 'skipped' ? 'skipped' : 'fulfilled';
  for (const request of pending) {
    await repo.updateStatus(request.id, status);
  }
  return pending.map((r) => r.id);
}
