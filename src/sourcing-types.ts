export interface SourcingSettings {
  enabled: boolean;
  localHour: number;
  timeZone: "Asia/Shanghai";
  autoIntake: boolean;
}

export interface SourcingSource {
  id: string;
  name: string;
  type: "lab" | "person" | "project" | "event" | "open_source" | "other";
  url: string;
  enabled: boolean;
  lastCheckedAt?: number;
  status?: "pending" | "checked" | "failed";
  detail?: string;
  focusIds?: string[];
  inScope?: boolean;
}

export type SourcingFocusType = "freeform" | "direction" | "lab" | "company" | "person";
export type SourcingRelation = "members" | "alumni" | "founders" | "employees" | "former_employees" | "students" | "coauthors" | "collaborators";

export interface SourcingFocus {
  id: string;
  name: string;
  type: SourcingFocusType;
  keywords: string[];
  excludedKeywords: string[];
  relations: SourcingRelation[];
  urls: string[];
  enabled: boolean;
}

export interface SourcingLibraryRef {
  type: "project" | "person";
  id: string;
  name: string;
}

export type SourcingContextEvidence = {
  kind: "library";
  entity: SourcingLibraryRef;
  quote: string;
  documentPath?: string;
} | {
  kind: "web";
  url: string;
  quote: string;
};

export interface SourcingContactPath {
  via: SourcingLibraryRef;
  chain: string[];
  basis: "library_record" | "public_overlap";
  reason: string;
  nextStep: string;
  evidence: SourcingContextEvidence[];
}

export interface SourcingResearchLink {
  target: SourcingLibraryRef;
  relation: "similar_product" | "same_direction" | "competitor" | "upstream" | "downstream" | "complementary" | "team_connection";
  reason: string;
  difference: string;
  evidence: SourcingContextEvidence[];
}

export interface SourcingContextResult<T> {
  status: "pending" | "found" | "not_found";
  note: string;
  checkedAt?: number;
  items: T[];
}

export interface SourcingCandidate {
  id: string;
  name: string;
  kind: "company" | "team" | "person" | "product";
  identityUrl?: string;
  founders: string[];
  summary: string;
  domain: string;
  tags: string[];
  signal: string;
  discoveredAt: number;
  lastSeenAt: number;
  signalDate?: string;
  stage: "new" | "watching" | "archived" | "excluded";
  confidence: "high" | "medium" | "low";
  sources: Array<{ url: string; title: string; type: string }>;
  discoveryPath: string[];
  relatedEntities: Array<{ type: "project" | "person"; id: string; name: string; relation: string }>;
  contactPaths?: SourcingContextResult<SourcingContactPath>;
  researchLinks?: SourcingContextResult<SourcingResearchLink>;
  intake: {
    status: "pending" | "matched" | "created" | "needs_review";
    projectId?: string;
    personIds?: string[];
    reason?: string;
    receipts?: Array<{ entityType: "project" | "person"; entityId: string; receiptPath: string; manifestPath: string }>;
  };
  nextAction: string;
}

export interface SourcingSnapshot {
  ok: boolean;
  configured: boolean;
  error?: string;
  candidates: SourcingCandidate[];
  sources: SourcingSource[];
  focuses?: SourcingFocus[];
  focusConfigured?: boolean;
  excludedSourceUrls?: string[];
  settings: SourcingSettings;
  run: {
    status: "idle" | "running" | "partial" | "failed";
    runId?: string;
    lastAttemptAt?: number;
    lastSuccessAt?: number;
    nextRunAt?: number;
    error?: string;
    coverage?: { checked: number; failed: number; pending: number };
    focusCoverage?: { checked: number; failed: number; pending: number };
    focusResults?: Array<{ focusId: string; status: "checked" | "failed" | "pending"; detail?: string }>;
  };
}

export type SourcingBeginResult = SourcingSnapshot & {
  started: boolean;
  runId?: string;
  leaseToken?: string;
  ledgerPath?: string;
  reason?: string;
};
