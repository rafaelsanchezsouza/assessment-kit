-- Branch assessments: per-reviewer refinement scopes on top of a parent
-- assessment (Assessment.branchOf in @gaf/types). Not a foreign key with
-- CASCADE on purpose: branches are archived, never deleted, when parents go.
ALTER TABLE assessments ADD COLUMN branch_of text;
CREATE INDEX idx_assessments_branch_of ON assessments (branch_of) WHERE branch_of IS NOT NULL;
