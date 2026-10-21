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
  settings: SourcingSettings;
  run: {
    status: "idle" | "running" | "partial" | "failed";
    runId?: string;
    lastAttemptAt?: number;
    lastSuccessAt?: number;
    nextRunAt?: number;
    error?: string;
    coverage?: { checked: number; failed: number; pending: number };
  };
}

export type SourcingBeginResult = SourcingSnapshot & {
  started: boolean;
  runId?: string;
  leaseToken?: string;
  ledgerPath?: string;
  reason?: string;
};
