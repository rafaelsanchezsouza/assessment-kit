-- Reference Postgres schema for the core GAF entities (docs/domain-model.md §2).
-- Structured fields are real columns; free-form/flexible parts are JSONB;
-- id-reference lists are text[].

CREATE TABLE subjects (
  id         text PRIMARY KEY,
  type       text NOT NULL,
  owner_id   text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_subjects_owner ON subjects (owner_id);

CREATE TABLE protocols (
  id           text NOT NULL,
  version      text NOT NULL,
  subject_type text NOT NULL,
  definition   jsonb NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE assessments (
  id                   text PRIMARY KEY,
  subject_id           text NOT NULL REFERENCES subjects (id),
  protocol_id          text NOT NULL,
  protocol_version     text NOT NULL,
  state                text NOT NULL,
  refinement_round     integer NOT NULL DEFAULT 0,
  prior_assessment_id  text REFERENCES assessments (id),
  applied_solution_ids text[],
  progress             jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_assessments_subject ON assessments (subject_id);

CREATE TABLE evidence (
  id             text PRIMARY KEY,
  subject_id     text NOT NULL REFERENCES subjects (id),
  type           text NOT NULL,
  payload_ref    text NOT NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_date  date
);
CREATE INDEX idx_evidence_subject ON evidence (subject_id);

CREATE TABLE assessment_evidence (
  assessment_id text NOT NULL REFERENCES assessments (id),
  evidence_id   text NOT NULL REFERENCES evidence (id),
  step_id       text NOT NULL,
  origin        text NOT NULL,
  PRIMARY KEY (assessment_id, evidence_id, step_id)
);

CREATE TABLE findings (
  id                text PRIMARY KEY,
  assessment_id     text NOT NULL REFERENCES assessments (id),
  subject_id        text NOT NULL REFERENCES subjects (id),
  statement_code    text NOT NULL,
  statement_params  jsonb NOT NULL DEFAULT '{}'::jsonb,
  statement_text    text NOT NULL,
  evidence_refs     text[] NOT NULL DEFAULT '{}',
  confidence        real NOT NULL,
  effective_date    date NOT NULL,
  produced_by_id      text NOT NULL,
  produced_by_version text NOT NULL
);
-- Backs the longitudinal query: all findings for a subject with a given code, over time.
CREATE INDEX idx_findings_subject_code ON findings (subject_id, statement_code);
CREATE INDEX idx_findings_assessment ON findings (assessment_id);

CREATE TABLE evidence_requests (
  id             text PRIMARY KEY,
  assessment_id  text NOT NULL REFERENCES assessments (id),
  kind           text NOT NULL,
  reason         text NOT NULL,
  step_spec      jsonb NOT NULL,
  requested_by_id text NOT NULL,
  status         text NOT NULL
);
CREATE INDEX idx_evidence_requests_assessment ON evidence_requests (assessment_id);

CREATE TABLE conditions (
  id               text PRIMARY KEY,
  assessment_id    text NOT NULL REFERENCES assessments (id),
  statement_code   text NOT NULL,
  statement_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  statement_text   text NOT NULL,
  finding_refs     text[] NOT NULL DEFAULT '{}',
  severity         real,
  confidence       real NOT NULL,
  derived_by_id      text NOT NULL,
  derived_by_version text NOT NULL
);
CREATE INDEX idx_conditions_assessment ON conditions (assessment_id);

CREATE TABLE recommendations (
  id                    text PRIMARY KEY,
  assessment_id         text NOT NULL REFERENCES assessments (id),
  condition_ids         text[] NOT NULL DEFAULT '{}',
  solution_id           text NOT NULL,
  rationale             text NOT NULL,
  confidence            real NOT NULL,
  priority              integer,
  recommended_by_id      text NOT NULL,
  recommended_by_version text NOT NULL,
  status                text NOT NULL
);
CREATE INDEX idx_recommendations_assessment ON recommendations (assessment_id);

CREATE TABLE outcome_records (
  id                     text PRIMARY KEY,
  condition_id           text NOT NULL,
  solution_id            text NOT NULL,
  baseline_assessment_id text NOT NULL REFERENCES assessments (id),
  followup_assessment_id text NOT NULL REFERENCES assessments (id),
  delta_finding_ids      text[] NOT NULL DEFAULT '{}',
  outcome                text NOT NULL
);
CREATE INDEX idx_outcome_records_condition ON outcome_records (condition_id);
