import type {
  Assessment,
  AssessmentEvidence,
  AssessmentRepository,
  Evidence,
  EvidenceRepository,
  EvidenceRequest,
  EvidenceRequestRepository,
  Finding,
  FindingRepository,
  Protocol,
  ProtocolRepository,
  Subject,
  SubjectRepository,
} from '@gaf/types';

/** Map-backed fakes of the @gaf/types storage ports — for tests only, no real persistence. */

export class InMemorySubjectRepository implements SubjectRepository {
  private readonly rows = new Map<string, Subject>();

  async create(subject: Subject): Promise<void> {
    this.rows.set(subject.id, subject);
  }

  async get(id: string): Promise<Subject | null> {
    return this.rows.get(id) ?? null;
  }

  async findByOwner(ownerId: string): Promise<Subject[]> {
    return [...this.rows.values()].filter((s) => s.ownerId === ownerId);
  }
}

export class InMemoryProtocolRepository implements ProtocolRepository {
  private readonly rows = new Map<string, Protocol>();

  async save(protocol: Protocol): Promise<void> {
    this.rows.set(`${protocol.id}@${protocol.version}`, protocol);
  }

  async get(id: string, version: string): Promise<Protocol | null> {
    return this.rows.get(`${id}@${version}`) ?? null;
  }

  async listVersions(id: string): Promise<string[]> {
    return [...this.rows.values()].filter((p) => p.id === id).map((p) => p.version);
  }
}

export class InMemoryAssessmentRepository implements AssessmentRepository {
  private readonly rows = new Map<string, Assessment>();

  async create(assessment: Assessment): Promise<void> {
    this.rows.set(assessment.id, assessment);
  }

  async get(id: string): Promise<Assessment | null> {
    return this.rows.get(id) ?? null;
  }

  async update(assessment: Assessment): Promise<void> {
    this.rows.set(assessment.id, assessment);
  }

  async findBySubject(subjectId: string): Promise<Assessment[]> {
    return [...this.rows.values()].filter((a) => a.subjectId === subjectId);
  }
}

export class InMemoryEvidenceRepository implements EvidenceRepository {
  private readonly rows = new Map<string, Evidence>();
  private readonly links: AssessmentEvidence[] = [];

  async create(evidence: Evidence): Promise<void> {
    this.rows.set(evidence.id, evidence);
  }

  async get(id: string): Promise<Evidence | null> {
    return this.rows.get(id) ?? null;
  }

  async findBySubject(subjectId: string): Promise<Evidence[]> {
    return [...this.rows.values()].filter((e) => e.subjectId === subjectId);
  }

  async linkToAssessment(link: AssessmentEvidence): Promise<void> {
    this.links.push(link);
  }

  async findByAssessment(assessmentId: string): Promise<AssessmentEvidence[]> {
    return this.links.filter((l) => l.assessmentId === assessmentId);
  }
}

export class InMemoryFindingRepository implements FindingRepository {
  private readonly rows: Finding[] = [];

  async create(finding: Finding): Promise<void> {
    this.rows.push(finding);
  }

  async findByAssessment(assessmentId: string): Promise<Finding[]> {
    return this.rows.filter((f) => f.assessmentId === assessmentId);
  }

  async findBySubjectAndCode(subjectId: string, code: string): Promise<Finding[]> {
    return this.rows.filter((f) => f.subjectId === subjectId && f.statement.code === code);
  }
}

export class InMemoryEvidenceRequestRepository implements EvidenceRequestRepository {
  private readonly rows = new Map<string, EvidenceRequest>();

  async create(request: EvidenceRequest): Promise<void> {
    this.rows.set(request.id, request);
  }

  async findByAssessment(assessmentId: string): Promise<EvidenceRequest[]> {
    return [...this.rows.values()].filter((r) => r.assessmentId === assessmentId);
  }

  async updateStatus(id: string, status: EvidenceRequest['status']): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.status = status;
  }
}
