import { z } from "zod";
import type { Db } from "../types";
export const Services = ["nonmedical", "skilled-home-health"] as const;
export const Roles = [
  "home-care-aide",
  "home-health-aide",
  "rn",
  "lpn-lvn",
] as const;
export const Topics = [
  "agency-license",
  "worker-license",
  "background-check",
  "training",
  "health-screening",
  "supervision",
  "records-reporting",
  "medicare-medicaid",
  "employment-safety",
  "privacy",
  "local-requirements",
] as const;
export const ProfileSchema = z.object({
  name: z.string().trim().min(1).max(150),
  ownership: z.enum(["for-profit", "nonprofit", "public", "unknown"]),
  headquarters: z.string().max(2),
  operatingStates: z.array(z.string().length(2)).max(51),
  services: z.array(z.enum(Services)),
  payers: z.array(z.enum(["private", "medicare", "medicaid"])),
  agencyLicense: z.string().max(200).default(""),
  programs: z.array(z.string().max(150)).max(50).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;
export const WorkerSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(150),
  role: z.enum(Roles),
  residence: z.string().length(2),
  serviceState: z.string().length(2),
  locality: z.string().max(100).default(""),
  service: z.enum(Services),
  licenseStates: z.array(z.string().length(2)),
  licenseExpires: z.string().max(10).default(""),
  caregiverId: z.string().max(80).optional(),
});
export type Worker = z.infer<typeof WorkerSchema>;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
export const CandidateSchema = z.object({
  title: z.string().min(3).max(250),
  citation: z.string().min(3).max(500),
  obligation: z.string().min(10).max(4000),
  quote: z.string().min(30).max(2500),
  section: z.number().int().nonnegative(),
  topic: z.enum(Topics),
  subject: z.enum(["agency", "worker"]),
  legalStatus: z.enum([
    "proposed",
    "enacted",
    "guidance",
    "repealed",
    "unknown",
  ]),
  effectiveFrom: date.nullable(),
  effectiveTo: date.nullable(),
  deadline: date.nullable(),
  services: z.array(z.enum(Services)).min(1),
  roles: z.array(z.enum(Roles)),
  ownership: z.array(z.enum(["for-profit", "nonprofit", "public"])),
  payers: z.array(z.enum(["private", "medicare", "medicaid"])),
  exceptions: z.string().max(3000),
  unresolved: z.array(z.string().max(500)).max(20),
  scopeComplete: z.boolean(),
  action: z.enum([
    "document",
    "training",
    "renewal",
    "supervision",
    "reporting",
    "agency-action",
  ]),
});
export type Candidate = z.infer<typeof CandidateSchema> & {
  verificationStatus?: "unverified";
  demo?: boolean;
  id: string;
  sourceId: string;
  snapshotId: string;
  jurisdiction: string;
  createdAt: string;
  evidenceValid: boolean;
  model: string;
  promptVersion: string;
  previousId?: string;
};
export interface Source {
  id: string;
  jurisdiction: string;
  title: string;
  url: string;
  authority: string;
  kind: "discovery" | "law" | "regulation" | "guidance";
  topic: (typeof Topics)[number];
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  intervalHours: number;
  lastChecked?: string;
  lastSuccess?: string;
  hash?: string;
  snapshotId?: string;
  error?: string;
  etag?: string;
  modified?: string;
}
export interface Section {
  index: number;
  label: string;
  text: string;
}
export interface Snapshot {
  id: string;
  sourceId: string;
  url: string;
  fetchedAt: string;
  hash: string;
  textHash: string;
  contentType: string;
  sections: Section[];
  rawBase64: string;
  links: { url: string; title: string }[];
  truncated: boolean;
}
export interface Job {
  snapshotId?: string;
  cursor?: number;
  id: string;
  sourceId: string;
  state: "queued" | "running" | "done" | "failed";
  attempts: number;
  availableAt: string;
  leaseUntil?: string;
  token?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}
export interface Review {
  ruleId: string;
  decision: "approved" | "rejected";
  reviewer: string;
  at: string;
  note: string;
}
export interface WorkerNotice {
  id: string;
  workerId: string;
  ruleId: string;
  title: string;
  body: string;
  reason: string;
  action: string;
  citation: string;
  sourceUrl: string;
  effectiveFrom: string;
  deadline: string | null;
  createdAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  channel: "in-app";
  generatedBy: "careloop-agent";
  demo: boolean;
}
export interface Notice {
  ruleId?: string;
  kind?: "regulatory-change" | "adoption";
  detail?: string;
  id: string;
  title: string;
  at: string;
  read: boolean;
}
export interface AgencyState {
  collection?: Db;
  profile: Profile;
  workers: Worker[];
  reviews: Review[];
  adopted: string[];
  actions: {
    id: string;
    ruleId: string;
    workerId?: string;
    title: string;
    kind: string;
    due: string | null;
    status: "open" | "done";
  }[];
  notices: Notice[];
  workerNotices?: WorkerNotice[];
  audit: { at: string; actor: string; action: string }[];
}
export interface Corpus {
  sources: Source[];
  candidates: Candidate[];
  jobs: Job[];
  lastTick?: string;
  usage: { day: string; calls: number; tokens: number };
}
export interface Context {
  agencyId: string;
  userId: string;
  role: "admin" | "viewer";
  local: boolean;
}
export const emptyAgency = (): AgencyState => ({
  profile: {
    name: "My agency",
    ownership: "unknown",
    headquarters: "",
    operatingStates: [],
    services: [],
    payers: [],
    agencyLicense: "",
    programs: [],
  },
  workers: [],
  reviews: [],
  adopted: [],
  actions: [],
  notices: [],
  workerNotices: [],
  audit: [],
});
