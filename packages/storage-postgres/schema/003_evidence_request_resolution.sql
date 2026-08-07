-- EvidenceRequest resolution (see plan.md, "EvidenceRequest resolution + the
-- re-request signal"). Two independent things, one migration:
--
-- 1. A one-off backfill. Until @assessment-kit/core learned to call
--    EvidenceRequestRepository.updateStatus, every request stayed 'pending'
--    forever — including ones answered long ago, which keep showing up as
--    outstanding asks to the capturer. Conservative on purpose: only requests
--    that provably have an answer are touched. A *skip* left no trace anywhere
--    (no evidence, no link), so skipped requests are unrecoverable — they stay
--    'pending' and can simply be skipped again.
--
--    Requests answered *badly* in the past are marked fulfilled too. Nothing can
--    tell good answers from bad ones retroactively, and that is consistent with
--    the optimistic model: the recourse is a re-request, never a status edit.
--
-- 2. The column the re-request signal writes to (populated from the next slice
--    on; harmless until then).

-- IF NOT EXISTS so the whole file can be re-executed against a migrated
-- database — the backfill test does exactly that on seeded stuck rows.
ALTER TABLE evidence_requests
  ADD COLUMN IF NOT EXISTS inadequate_evidence_refs text[] NOT NULL DEFAULT '{}';

UPDATE evidence_requests er
   SET status = 'fulfilled'
 WHERE er.status = 'pending'
   AND EXISTS (
     SELECT 1
       FROM assessment_evidence ae
      WHERE ae.assessment_id = er.assessment_id
        AND ae.step_id = er.step_spec->>'id'
   );
