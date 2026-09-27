import { fileURLToPath } from "node:url";

export const GOLDEN_DIR = fileURLToPath(new URL("./golden/chunks", import.meta.url));

/** Ten representative notes whose chunks are pinned as golden files. */
export const CHUNK_GOLDEN_NOTES = [
  "kb/admissions/enroll-a-returning-student-in-salesforce.md",
  "kb/admissions/admissions-application-review.md",
  "kb/admissions/enrollment-status-codes.md",
  "kb/admissions/actions/resend-enrollment-confirmation.md",
  "kb/finance/how-deposits-flow-from-salesforce-to-netsuite.md",
  "kb/finance/request-types/request-access-to-netsuite.md",
  "kb/finance/month-end-close-process.md",
  "kb/it-support/runbooks/lms-outage-response.md",
  "kb/people-ops/leave-policy.md",
  "kb/_themes/enrollment.md",
];
