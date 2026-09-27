#!/usr/bin/env node
// Builds fixtures/vault-acme from the data below. Run once, review the diff, then commit.
// Generated files (index.md, hub member lists, _meta/) come from `kb index` afterwards.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNoteText } from "../../packages/okf/src/note.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/vault-acme");
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Deterministic ULID-shaped id from a slug, so the fixture is stable across rebuilds. */
function idFor(slug) {
  const h = createHash("sha256").update(slug).digest();
  let body = "01J9Z";
  for (let i = 0; body.length < 26; i++) body += CROCKFORD[h[i] % 32];
  return "kb_" + body;
}

const FIXED_IDS = {
  "admissions/enroll-a-returning-student-in-salesforce": "kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D",
  "finance/request-types/request-access-to-netsuite": "kb_01J9Z7K2M4P6R8T0V2X4Z6B8C9",
  "admissions/actions/resend-enrollment-confirmation": "kb_01J9Z8A3C5E7G9H1K3M5N7P9Q2",
};

const REVIEW = { "How-To": 180, Process: 180, Runbook: 180, Action: 180, Explanation: 365, Reference: 365, Policy: 365, "Request Type": 365, System: 365 };

function addDays(iso, days) {
  return new Date(Date.parse(iso) + days * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const files = {};

function note(path, fm, body, opts = {}) {
  const slug = path.replace(/\.md$/, "");
  const at = opts.at ?? "2026-08-03T09:00:00Z";
  const author = opts.by ?? "human:mreyes";
  const data = {
    type: fm.type,
    title: fm.title,
    description: fm.description,
    id: FIXED_IDS[slug] ?? idFor(slug),
    version: fm.version ?? (fm.status === "draft" ? "0.1.0" : "1.0.0"),
    ...(fm.themes ? { themes: fm.themes } : {}),
    ...(fm.systems ? { systems: fm.systems } : {}),
    ...(fm.tags ? { tags: fm.tags } : {}),
    ...(fm.owner ? { owner: fm.owner } : {}),
    ...(fm.aliases ? { aliases: fm.aliases } : {}),
    ...(fm.resource ? { resource: fm.resource } : {}),
    ...(fm.status ? { status: fm.status } : {}),
    generated: { by: author, at },
  };
  if (opts.verified !== false) {
    const vby = opts.verifiedBy ?? author;
    if (vby.startsWith("human:") || vby.startsWith("process:")) {
      data.verified = [{ by: vby, at }];
      const days = REVIEW[fm.type];
      if (days) data.stale_after = opts.staleAfter ?? addDays(at, days);
    }
  }
  if (fm.sources) data.sources = fm.sources;
  Object.assign(data, fm.extra ?? {});
  files[`kb/${path}`] = buildNoteText(data, body);
}

function hub(kind, slug, title, description, intro, aliases) {
  const folder = kind === "theme" ? "_themes" : "_systems";
  note(
    `${folder}/${slug}.md`,
    { type: kind === "theme" ? "Theme" : "System", title, description, ...(aliases ? { aliases } : {}) },
    `# Overview\n\n${intro}\n\n# Members\n\n<!-- kb:members:start -->\n<!-- kb:members:end -->\n`,
    { at: "2026-06-01T00:00:00Z" },
  );
}

// ------------------------------------------------------------------------------------------------
// Hubs

hub("theme", "enrollment", "Enrollment", "The student journey from application to an active enrollment, across admissions, finance, and IT.",
  "Enrollment covers everything from a submitted application to a student who can attend classes: admission decisions, deposits, the Salesforce enrollment record, and the SIS account. Each team documents its own part in its own namespace; this hub collects them.", ["enrolment", "registration"]);
hub("theme", "onboarding", "Onboarding", "Getting new staff and new students ready on day one: accounts, equipment, and orientation.",
  "Onboarding spans People Ops (employment paperwork), IT (accounts and laptops), and Admissions (student orientation).");
hub("theme", "access-management", "Access management", "Granting, changing, and removing access to company systems.",
  "Access requests go through the owning system team. Use the Request Types listed below instead of emailing people directly.", ["permissions"]);
hub("theme", "month-end-close", "Month-end close", "Finance's monthly close: reconciliations, accruals, and reporting.",
  "The close runs over the first five working days of each month. The Process note is the backbone; the How-Tos cover individual steps.", ["close", "month end"]);

hub("system", "salesforce", "Salesforce", "The CRM for applicants and students, including enrollment records.",
  "Salesforce holds contacts, applications, and Enrollment__c records. Admissions Ops owns the configuration.", ["sfdc"]);
hub("system", "sis", "SIS", "The student information system: the record of courses, grades, and student accounts.",
  "The SIS is the system of record for academic data. A nightly job syncs enrollments from Salesforce.", ["student information system"]);
hub("system", "netsuite", "NetSuite", "The ERP for the general ledger, receivables, payables, and payroll journals.",
  "Finance Systems owns NetSuite roles and integrations.", ["erp"]);
hub("system", "lms", "LMS", "The learning management system where courses and course materials live.",
  "IT Support runs the LMS. Instructors get course shells automatically from the SIS.", ["canvas", "learning management system"]);

// ------------------------------------------------------------------------------------------------
// Admissions

note("admissions/enroll-a-returning-student-in-salesforce.md", {
  type: "How-To", title: "Enroll a returning student in Salesforce",
  description: "Reactivate a former student's record and open a new enrollment without creating a duplicate contact.",
  version: "1.2.0", themes: ["enrollment"], systems: ["salesforce", "sis"], tags: ["returning-students", "duplicates"],
  owner: "admissions-ops", aliases: ["re-enroll a student", "reactivate a student", "re-enroll returning student"],
  resource: "https://acme.lightning.force.com/lightning/o/Enrollment__c/home",
  sources: [{ id: "sis-sop", resource: "/admissions/references/sis-enrollment-sop-2025.md", title: "SIS enrollment SOP (2025)" }],
  extra: { audience: "all-staff" },
}, `# When to use this

Use this when a student who left or graduated applies again. For first-time
students, follow [Enroll a new student](/admissions/enroll-a-new-student.md).

# Steps

1. Search Salesforce by student ID, not by name. Returning students keep their ID.[^sis-sop]
2. Open the existing contact and set the status to Returning.
3. Create the enrollment from the contact, never from the Enrollments tab.
4. Wait for the nightly sync to update the SIS. If the student needs access sooner, ask IT to
   [restart the SIS sync job](/it-support/runbooks/restart-the-sis-sync-job.md).

# Related

- [Enrollment](/_themes/enrollment.md)
- [Clean up duplicate contacts](/admissions/clean-up-duplicate-contacts.md)
- [Enrollment status codes](/admissions/enrollment-status-codes.md)

[^sis-sop]: SIS enrollment SOP (2025)
`, { at: "2026-09-02T08:15:00Z" });

note("admissions/enroll-a-new-student.md", {
  type: "How-To", title: "Enroll a new student", description: "Create the contact and first enrollment for a student who has never studied here.",
  themes: ["enrollment"], systems: ["salesforce"], tags: ["new-students"], extra: { audience: "all-staff" },
}, `# When to use this

Use this for an admitted applicant with no earlier record. Returning students follow
[Enroll a returning student in Salesforce](/admissions/enroll-a-returning-student-in-salesforce.md).

# Steps

1. Search Salesforce by email and date of birth to confirm there is no existing contact.
2. Convert the application to a contact. Salesforce assigns the student ID.
3. Create the enrollment from the contact with the admitted program and term.
4. Ask Finance to [post the enrollment deposit](/finance/post-an-enrollment-deposit.md) if one was paid.

# Related

- [Enrollment](/_themes/enrollment.md)
- [Check an application's status](/admissions/check-an-applications-status.md)
`);

note("admissions/clean-up-duplicate-contacts.md", {
  type: "How-To", title: "Clean up duplicate contacts", description: "Find and merge duplicate student contacts in Salesforce so each student has one record.",
  themes: ["enrollment"], systems: ["salesforce"], tags: ["duplicates"],
}, `# When to use this

Use this when the duplicate report shows two contacts for the same student, usually after
someone enrolled a returning student from the Enrollments tab.

# Steps

1. Open the Duplicate Contacts report in Salesforce.
2. Compare student ID, email, and date of birth. Only merge when the student ID matches.
3. Choose the older contact as the master record and merge.
4. Check that enrollments from both contacts now sit on the master record.

# Related

- [Salesforce](/_systems/salesforce.md)
- [Enroll a returning student in Salesforce](/admissions/enroll-a-returning-student-in-salesforce.md)
- [Use the student ID as the primary key](/admissions/use-the-student-id-as-the-primary-key.md)
`);

note("admissions/merge-duplicate-student-records.md", {
  type: "How-To", title: "Merge duplicate student records", description: "Merge two Salesforce contacts that belong to the same student into one record.",
  themes: ["enrollment"], systems: ["salesforce"], tags: ["duplicates"],
}, `# When to use this

Use this when a student appears twice in Salesforce, for example after re-enrolling from the
Enrollments tab.

# Steps

1. Run the Duplicate Contacts report in Salesforce.
2. Confirm the two contacts share a student ID before merging.
3. Keep the older contact as the master record.
4. Make sure every enrollment ends up on the master record.

# Related

- [Salesforce](/_systems/salesforce.md)
`, { at: "2026-07-20T10:00:00Z" });

note("admissions/admissions-application-review.md", {
  type: "Process", title: "Admissions application review",
  description: "How an application moves from submitted to a decision, who reviews it, and how long each step takes.",
  version: "2.0.0", themes: ["enrollment"], systems: ["salesforce"], tags: ["applications"],
}, `# Overview

Every application is reviewed within 10 working days of the last document arriving.
Since September 2026 the second reader step is done by the program lead instead of a
second admissions officer.

# Roles

- Admissions officer: checks documents and scores the application.
- Program lead: second reader for borderline scores and final decision.

# Steps

1. The applicant submits the application and documents in the portal.
2. An admissions officer checks the documents within 3 working days.
3. The officer scores the application in Salesforce.
4. Scores between 60 and 75 go to the program lead as second reader.
5. The decision is recorded in Salesforce, which emails the applicant.
6. Admitted applicants are enrolled following [Enroll a new student](/admissions/enroll-a-new-student.md).

# Related

- [Enrollment](/_themes/enrollment.md)
- [Transcript evaluation policy](/admissions/transcript-evaluation-policy.md)
`, { at: "2026-09-15T02:00:00Z" });

note("admissions/how-enrollment-statuses-work.md", {
  type: "Explanation", title: "How enrollment statuses work", description: "Why an enrollment moves through Pending, Confirmed, Active, and Closed, and what each status controls.",
  themes: ["enrollment"], systems: ["salesforce", "sis"], tags: ["enrollment-status"],
}, `# Overview

An enrollment's status decides what the student can do and which systems know about them.
Pending enrollments exist only in Salesforce. Confirmed enrollments are sent to the SIS by
the nightly sync. Active means the term has started and the LMS course shells are open.
Closed means the term ended or the student withdrew.

# How it works

Status changes are driven by payments and dates rather than by hand. A deposit moves an
enrollment from Pending to Confirmed. The term start date moves it to Active.
See [Enrollment status codes](/admissions/enrollment-status-codes.md) for the exact values.

# Related

- [Enrollment](/_themes/enrollment.md)
- [How the SIS to Salesforce sync works](/it-support/how-the-sis-to-salesforce-sync-works.md)
`);

note("admissions/enrollment-status-codes.md", {
  type: "Reference", title: "Enrollment status codes", description: "Every Enrollment__c status value in Salesforce with its SIS equivalent.",
  themes: ["enrollment"], systems: ["salesforce", "sis"], tags: ["enrollment-status"],
}, `# Overview

Use these values when filtering enrollment reports or reading sync errors.

# Details

| Salesforce status | SIS code | Meaning |
| --- | --- | --- |
| Pending | PEND | Created, no deposit yet |
| Confirmed | CONF | Deposit received |
| Active | ACTV | Term has started |
| Returning | RTRN | Former student re-enrolling |
| Closed | CLSD | Term ended or withdrawn |

# Related

- [Enrollment](/_themes/enrollment.md)
- [How enrollment statuses work](/admissions/how-enrollment-statuses-work.md)
`);

note("admissions/transcript-evaluation-policy.md", {
  type: "Policy", title: "Transcript evaluation policy", description: "Which transcripts Admissions accepts and how foreign transcripts are evaluated.",
  themes: ["enrollment"], tags: ["applications"],
}, `# Policy

Admissions accepts official transcripts sent directly by the issuing school or through an
approved credential service. Foreign transcripts need a course-by-course evaluation.

# Scope

All undergraduate and graduate applications.

# Exceptions

The program lead can accept an unofficial transcript for a conditional admission, as
described in [Admissions application review](/admissions/admissions-application-review.md).

# Related

- [Enrollment](/_themes/enrollment.md)
`);

note("admissions/use-the-student-id-as-the-primary-key.md", {
  type: "Decision", title: "Use the student ID as the primary key", description: "Why Salesforce and the SIS match students by student ID instead of name or email.",
  themes: ["enrollment"], systems: ["salesforce", "sis"], tags: ["duplicates"],
}, `# Context

In 2024 matching by email created thousands of duplicate contacts when students changed
their email address.

# Decision

Salesforce and the SIS match students only by student ID. Returning students keep their ID.

# Consequences

Staff must always search by student ID first. Duplicates are cleaned up with
[Clean up duplicate contacts](/admissions/clean-up-duplicate-contacts.md).

# Related

- [Salesforce](/_systems/salesforce.md)
`, { at: "2026-02-10T09:00:00Z" });

note("admissions/references/sis-enrollment-sop-2025.md", {
  type: "Source Document", title: "SIS enrollment SOP (2025)", description: "Extracted text of the 2025 SIS enrollment standard operating procedure.",
  themes: ["enrollment"], systems: ["sis"],
}, `# Extracted text

SIS Enrollment Standard Operating Procedure, revision 2025-03.

1. Returning students retain their original student identification number.
2. Staff shall search the student record by identification number prior to creating any record.
3. Enrollment records are created from the student record and never independently.
4. The nightly synchronization job transfers confirmed enrollments to the SIS.
`, { by: "lore-ingest/claude-sonnet-5", verified: false, at: "2026-05-01T00:00:00Z" });

note("admissions/actions/resend-enrollment-confirmation.md", {
  type: "Action", title: "Resend the enrollment confirmation email", description: "Re-sends the enrollment confirmation email for one enrollment record.",
  version: "1.1.0", themes: ["enrollment"], systems: ["salesforce"],
  extra: {
    execution: "auto", risk: "low", approvers: [], runtime: "http",
    parameters: [{ name: "enrollment_id", type: "string", required: true }],
    executor: { resource: "gateway://salesforce/resend-enrollment-confirmation", receipt: ["request_id", "status", "sent_at"] },
  },
}, `# When to use

The student says the confirmation email never arrived and the enrollment
status in Salesforce is Confirmed.

# Manual procedure

1. Open the enrollment record in Salesforce.
2. Check that the contact's email address is correct and fix it if needed.
3. Choose Send confirmation from the record's action menu.

# Rollback

None needed. Sending the email again is harmless.

# Related

- [Salesforce](/_systems/salesforce.md)
`, { by: "human:jlim", at: "2026-09-10T03:00:00Z" });

note("admissions/submit-a-paper-enrollment-form.md", {
  type: "How-To", title: "Submit a paper enrollment form", description: "The old paper process for enrolling a student, replaced by enrollment in Salesforce.",
  version: "1.4.0", themes: ["enrollment"], status: "deprecated",
  extra: { superseded_by: "/admissions/enroll-a-new-student.md" },
}, `# When to use this

Do not use this. Paper forms were retired in January 2026.

# Steps

1. Print the enrollment form.
2. Collect signatures from the student and the registrar.
3. Send the form to the SIS team for manual entry.

# Related

- [Enroll a new student](/admissions/enroll-a-new-student.md)
- [Enrollment](/_themes/enrollment.md)
`, { at: "2025-06-01T00:00:00Z", staleAfter: "2025-12-01T00:00:00Z" });

note("admissions/manage-the-course-waitlist.md", {
  type: "How-To", title: "Manage the course waitlist", description: "Move waitlisted students into open seats in the order they joined.",
  themes: ["enrollment"], systems: ["sis"], status: "draft",
}, `# When to use this

Use this when a seat opens in a full course section.

# Steps

1. Open the section's waitlist in the SIS.
2. Offer the seat to the first student on the list.
3. If they do not accept within 48 hours, offer it to the next student.

# Related

- [Enrollment](/_themes/enrollment.md)
`, { verified: false });

note("admissions/run-new-student-orientation.md", {
  type: "How-To", title: "Run new student orientation", description: "Prepare and run the orientation session for newly enrolled students.",
  themes: ["onboarding", "enrollment"], systems: ["lms"], tags: ["new-students"],
}, `# When to use this

Two weeks before each term starts.

# Steps

1. Export the list of Confirmed enrollments for the term from Salesforce.
2. Enroll the students in the Orientation course in the LMS.
3. Send the orientation invitation from the Admissions mailbox.

# Related

- [Onboarding](/_themes/onboarding.md)
`);

note("admissions/check-an-applications-status.md", {
  type: "How-To", title: "Check an application's status", description: "Look up where an application is in review and what the applicant still needs to send.",
  themes: ["enrollment"], systems: ["salesforce"], tags: ["applications"],
}, `# When to use this

When an applicant asks what is happening with their application.

# Steps

1. Search Salesforce for the application by applicant email.
2. Read the Stage field and the Missing Documents list.
3. Tell the applicant which documents are missing and the expected decision date from
   [Admissions application review](/admissions/admissions-application-review.md).

# Related

- [Enrollment](/_themes/enrollment.md)
`);

files["kb/admissions/log.md"] = `# Admissions log

## 2026-09-15

- Process change: [Admissions application review](/admissions/admissions-application-review.md) 1.3.0 to 2.0.0 by human:mreyes. The program lead is now the second reader.

## 2026-01-12

- Deprecated [Submit a paper enrollment form](/admissions/submit-a-paper-enrollment-form.md) in favour of [Enroll a new student](/admissions/enroll-a-new-student.md).
`;

// ------------------------------------------------------------------------------------------------
// Finance

note("finance/post-an-enrollment-deposit.md", {
  type: "How-To", title: "Post an enrollment deposit", description: "Record a student's enrollment deposit in NetSuite so the enrollment becomes Confirmed.",
  themes: ["enrollment"], systems: ["netsuite", "salesforce"], tags: ["deposits"],
}, `# When to use this

When a deposit arrives by bank transfer instead of the online payment page.

# Steps

1. Find the student's customer record in NetSuite by student ID.
2. Create a customer deposit for the amount received against the enrollment.
3. Check the next morning that the enrollment in Salesforce shows Confirmed.

# Related

- [Enrollment](/_themes/enrollment.md)
- [How deposits flow from Salesforce to NetSuite](/finance/how-deposits-flow-from-salesforce-to-netsuite.md)
`, { by: "human:bchan" });

note("finance/how-deposits-flow-from-salesforce-to-netsuite.md", {
  type: "Explanation", title: "How deposits flow from Salesforce to NetSuite",
  description: "The integration that turns online deposits in Salesforce into customer deposits in NetSuite.",
  themes: ["enrollment"], systems: ["salesforce", "netsuite"], tags: ["deposits", "sync"],
  sources: [{ id: "deposit-spec", resource: "/finance/references/deposit-integration-spec-2025.md", title: "Deposit integration spec (2025)" }],
}, `# Overview

Online deposits are captured in Salesforce and pushed to NetSuite every 15 minutes.[^deposit-spec]

# How it works

1. The payment page creates a Payment record on the enrollment in Salesforce.
2. The integration picks up new Payment records and creates a customer deposit in NetSuite.
3. NetSuite returns the deposit number, which is written back to Salesforce.
4. A workflow in Salesforce moves the enrollment to Confirmed.

Deposits received by bank transfer skip this flow and are entered by hand, see
[Post an enrollment deposit](/finance/post-an-enrollment-deposit.md).

# Related

- [NetSuite](/_systems/netsuite.md)

[^deposit-spec]: Deposit integration spec (2025)
`, { by: "lore-ingest/claude-sonnet-5", verified: false, at: "2026-09-20T06:00:00Z" });

note("finance/references/deposit-integration-spec-2025.md", {
  type: "Source Document", title: "Deposit integration spec (2025)", description: "Extracted text of the 2025 Salesforce to NetSuite deposit integration specification.",
  systems: ["salesforce", "netsuite"],
}, `# Extracted text

Integration: Salesforce Payment__c to NetSuite Customer Deposit. Schedule: every 15 minutes.
Matching key: student ID. On success the NetSuite deposit number is written to Payment__c.External_Id__c.
`, { by: "lore-ingest/claude-sonnet-5", verified: false, at: "2026-09-20T06:00:00Z" });

note("finance/netsuite-access-levels.md", {
  type: "Reference", title: "NetSuite access levels", description: "The NetSuite roles Finance Systems grants and what each one can do.",
  themes: ["access-management"], systems: ["netsuite"], tags: ["access-requests"],
}, `# Overview

Pick the smallest role that covers the work. Managers approve every role request.

# Details

| Role | Can do |
| --- | --- |
| Viewer | Read reports and transactions |
| AP Clerk | Enter and edit vendor bills |
| AR Clerk | Enter invoices and customer payments |

# Related

- [Access management](/_themes/access-management.md)
- [Request access to NetSuite](/finance/request-types/request-access-to-netsuite.md)
`, { by: "human:bchan" });

note("finance/runbooks/grant-netsuite-access.md", {
  type: "Runbook", title: "Grant NetSuite access", description: "How Finance Systems grants or changes a NetSuite role after the manager approves.",
  themes: ["access-management"], systems: ["netsuite"], tags: ["access-requests"],
}, `# Trigger

A NetSuite access ticket with manager approval in the ticket.

# Diagnosis

Check the requested role against [NetSuite access levels](/finance/netsuite-access-levels.md).

# Resolution

1. Open Setup, Users/Roles, Manage Users in NetSuite.
2. Find the employee record and add the approved role.
3. Save and ask the requester to sign out and back in.

# Rollback

Remove the role from the employee record.

# Related

- [NetSuite](/_systems/netsuite.md)
`, { by: "human:bchan" });

note("finance/request-types/request-access-to-netsuite.md", {
  type: "Request Type", title: "Request access to NetSuite", description: "Ask Finance Systems to grant or change NetSuite access for a user.",
  themes: ["access-management"], systems: ["netsuite"], tags: ["access-requests"],
  extra: {
    kind: "request", route_to: "finance-systems", follow_up_after: "P2D",
    self_service: "/finance/netsuite-access-levels.md", runbook: "/finance/runbooks/grant-netsuite-access.md",
    fields: [
      { name: "user_email", type: "email", required: true, label: "Who needs access?" },
      { name: "role", type: "select", required: true, options: ["AP Clerk", "AR Clerk", "Viewer"] },
      { name: "reason", type: "text", required: true, label: "What do they need it for?" },
      { name: "needed_by", type: "date", required: false },
    ],
    examples: ["I need access to NetSuite", "can you give my new hire NetSuite AP access", "NetSuite says I don't have permission to approve bills"],
  },
}, `# What happens next

Finance Systems grants access within 2 working days after the requester's
manager approves the request in the ticket.

# Related

- [Access management](/_themes/access-management.md)
`, { by: "human:bchan" });

note("finance/month-end-close-process.md", {
  type: "Process", title: "Month-end close process", description: "The five-day monthly close: who does which step on which working day.",
  themes: ["month-end-close"], systems: ["netsuite"], tags: ["reconciliation"],
}, `# Overview

The close starts on the first working day and ends with the management pack on day five.

# Roles

- AP team: vendor bills and accruals.
- AR team: invoices, deposits, and receivables.
- Controller: review and sign-off.

# Steps

1. Day 1: cut off AP and AR entry for the prior month.
2. Day 2: [reconcile bank accounts](/finance/reconcile-bank-accounts.md).
3. Day 3: [accrue unbilled revenue](/finance/accrue-unbilled-revenue.md) and expenses.
4. Day 4: controller review of the trial balance.
5. Day 5: publish the management pack.

# Related

- [Month-end close](/_themes/month-end-close.md)
`, { by: "human:bchan" });

note("finance/reconcile-bank-accounts.md", {
  type: "How-To", title: "Reconcile bank accounts", description: "Match NetSuite cash transactions to bank statements during the close.",
  themes: ["month-end-close"], systems: ["netsuite"], tags: ["reconciliation"],
}, `# When to use this

On day 2 of the [month-end close](/finance/month-end-close-process.md).

# Steps

1. Import the bank statement file into NetSuite's bank reconciliation screen.
2. Accept the automatic matches.
3. Investigate unmatched lines over 100 dollars and post adjustments.

# Related

- [Month-end close](/_themes/month-end-close.md)
`, { by: "human:bchan" });

note("finance/accrue-unbilled-revenue.md", {
  type: "How-To", title: "Accrue unbilled revenue", description: "Post the month-end accrual for tuition earned but not yet invoiced.",
  themes: ["month-end-close"], systems: ["netsuite"], tags: ["reconciliation"],
}, `# When to use this

On day 3 of the [month-end close](/finance/month-end-close-process.md).

# Steps

1. Run the Unbilled Tuition saved search in NetSuite.
2. Post a reversing journal entry for the total, coded as described in
   [NetSuite journal entry codes](/finance/netsuite-journal-entry-codes.md).

# Related

- [Month-end close](/_themes/month-end-close.md)
`, { by: "human:bchan" });

note("finance/netsuite-journal-entry-codes.md", {
  type: "Reference", title: "NetSuite journal entry codes", description: "Journal entry types and account codes used in the close.",
  themes: ["month-end-close"], systems: ["netsuite"],
}, `# Overview

Use these codes on manual journal entries.

# Details

| Code | Use |
| --- | --- |
| ACR | Accruals, always reversing |
| RCL | Reclassifications |
| ADJ | Bank reconciliation adjustments |

# Related

- [NetSuite](/_systems/netsuite.md)
`, { by: "process:ledger-check", verifiedBy: "process:ledger-check" });

note("finance/issue-a-student-refund.md", {
  type: "How-To", title: "Issue a student refund", description: "Refund a deposit or tuition payment to a student who withdrew.",
  themes: ["enrollment"], systems: ["netsuite"], tags: ["refunds"],
}, `# When to use this

When a student withdraws before the refund deadline in the [refund policy](/finance/refund-policy.md).

# Steps

1. Confirm the enrollment is Closed in Salesforce.
2. Create a customer refund in NetSuite against the deposit or payment.
3. Refunds up to 500 dollars can use the [Issue a small refund](/finance/actions/issue-a-small-refund.md) action.

# Related

- [Enrollment](/_themes/enrollment.md)
`, { by: "human:bchan" });

note("finance/refund-policy.md", {
  type: "Policy", title: "Refund policy", description: "When students get their deposit and tuition back after withdrawing.",
  themes: ["enrollment"], tags: ["refunds"], extra: { audience: "all-staff" },
}, `# Policy

Deposits are refundable until 30 days before the term starts. Tuition is refunded in full
in the first week of term and at 50 percent in the second week.

# Scope

All programs.

# Exceptions

The controller can approve exceptions for medical withdrawals.

# Related

- [Enrollment](/_themes/enrollment.md)
`, { by: "human:bchan" });

note("finance/actions/issue-a-small-refund.md", {
  type: "Action", title: "Issue a small refund", description: "Refund up to 500 dollars to a student after a withdrawal.",
  themes: ["enrollment"], systems: ["netsuite"], tags: ["refunds"],
  extra: {
    execution: "approval", risk: "medium", approvers: ["finance-systems"], runtime: "http",
    parameters: [
      { name: "student_id", type: "string", required: true },
      { name: "amount", type: "number", required: true, description: "Refund amount in dollars, at most 500" },
      { name: "reason", type: "enum", required: true, values: ["withdrawal", "overpayment", "duplicate-payment"] },
    ],
    executor: { resource: "gateway://netsuite/issue-refund", receipt: ["refund_id", "status"] },
  },
}, `# When to use

A student withdrew within the [refund policy](/finance/refund-policy.md) and the amount is at most 500 dollars.

# Manual procedure

1. Open the student's customer record in NetSuite.
2. Create a customer refund for the amount against the original payment.
3. Add the reason in the memo field.

# Rollback

Void the customer refund in NetSuite before the payment run.

# Related

- [NetSuite](/_systems/netsuite.md)
`, { by: "human:bchan" });

note("finance/approve-vendor-invoices.md", {
  type: "How-To", title: "Approve vendor invoices", description: "How budget holders approve vendor bills in NetSuite before payment.",
  themes: ["month-end-close"], systems: ["netsuite"], tags: ["accounts-payable"],
}, `# When to use this

When NetSuite emails you that a vendor bill is waiting for your approval.

# Steps

1. Open the bill from the email link.
2. Check the amount against the purchase order.
3. Approve, or reject with a comment for the AP team.

# Related

- [Month-end close](/_themes/month-end-close.md)
`, { by: "human:bchan", at: "2025-11-01T00:00:00Z", staleAfter: "2026-05-01T00:00:00Z" });

note("finance/close-accounts-payable.md", {
  type: "How-To", title: "Close accounts payable for the month", description: "Cut off vendor bill entry and post AP accruals on day 1 of the close.",
  themes: ["month-end-close"], systems: ["netsuite"], tags: ["accounts-payable"],
}, `# When to use this

On day 1 of the [month-end close](/finance/month-end-close-process.md).

# Steps

1. Lock the AP period for the prior month in NetSuite.
2. Accrue received-not-billed purchase orders.

# Related

- [Month-end close](/_themes/month-end-close.md)
`, { by: "human:bchan" });

// ------------------------------------------------------------------------------------------------
// IT support

note("it-support/how-the-sis-to-salesforce-sync-works.md", {
  type: "Explanation", title: "How the SIS to Salesforce sync works", description: "The nightly job that copies confirmed enrollments from Salesforce to the SIS and results back.",
  themes: ["enrollment"], systems: ["sis", "salesforce"], tags: ["sync"],
}, `# Overview

A nightly job at 01:00 copies Confirmed enrollments from Salesforce to the SIS and writes
the SIS enrollment number back to Salesforce.

# How it works

1. The job queries Enrollment__c records changed since the last run.
2. Each record is matched to the SIS student by student ID.
3. Errors are written to the Sync Errors report in Salesforce.

When the job fails, follow [Restart the SIS sync job](/it-support/runbooks/restart-the-sis-sync-job.md).

# Related

- [SIS](/_systems/sis.md)
- [Enrollment status codes](/admissions/enrollment-status-codes.md)
`, { by: "human:tnguyen" });

note("it-support/runbooks/restart-the-sis-sync-job.md", {
  type: "Runbook", title: "Restart the SIS sync job", description: "Restart the Salesforce to SIS enrollment sync after a failed or stuck run.",
  themes: ["enrollment"], systems: ["sis", "salesforce"], tags: ["sync"],
}, `# Trigger

The Sync Errors report shows a run-level failure, or no run finished since 01:00.

# Diagnosis

1. Check the job history in the integration console.
2. If the last run failed on authentication, the integration user's password expired.

# Resolution

1. Reset the integration user's password and update the connection.
2. Start the job manually from the integration console.

# Rollback

Stop the manual run; the next scheduled run picks up the same records.

# Related

- [SIS](/_systems/sis.md)
`, { by: "human:tnguyen" });

note("it-support/reset-a-staff-password.md", {
  type: "How-To", title: "Reset a staff password", description: "Reset a staff member's single sign-on password after verifying who they are.",
  themes: ["access-management"], tags: ["passwords"], extra: { audience: "all-staff" },
}, `# When to use this

A staff member forgot their password. Locked accounts follow
[Unlock a locked account](/it-support/unlock-a-locked-account.md) instead.

# Steps

1. Verify the caller with their employee ID and manager's name.
2. Reset the password in the identity provider and tick "require change at next sign-in".
3. Remind them that [multi-factor authentication](/it-support/multi-factor-authentication-policy.md) is required.

# Related

- [Access management](/_themes/access-management.md)
`, { by: "human:tnguyen" });

note("it-support/multi-factor-authentication-policy.md", {
  type: "Policy", title: "Multi-factor authentication policy", description: "Every staff account must use multi-factor authentication with an authenticator app.",
  themes: ["access-management"], tags: ["security"], extra: { audience: "all-staff" },
}, `# Policy

All staff accounts use multi-factor authentication. SMS codes are not allowed; use an
authenticator app or a hardware key.

# Scope

Every staff and contractor account.

# Exceptions

None.

# Related

- [Access management](/_themes/access-management.md)
`, { by: "human:tnguyen" });

note("it-support/set-up-a-new-hire-laptop.md", {
  type: "How-To", title: "Set up a new hire laptop", description: "Prepare, enroll, and hand over a laptop for a new employee.",
  themes: ["onboarding"], tags: ["laptops", "new-hires"],
}, `# When to use this

When People Ops confirms a start date, at least three working days before day one.

# Steps

1. Take a laptop from stock and enroll it in device management.
2. Sign in once as the new hire so their profile is created.
3. Hand it over on day one together with the [multi-factor authentication](/it-support/multi-factor-authentication-policy.md) setup.

# Related

- [Onboarding](/_themes/onboarding.md)
- [Request a laptop](/it-support/request-types/request-a-laptop.md)
`, { by: "human:tnguyen" });

note("it-support/request-types/request-a-laptop.md", {
  type: "Request Type", title: "Request a laptop", description: "Ask IT Support for a new or replacement laptop.",
  themes: ["onboarding"], tags: ["laptops"],
  extra: {
    kind: "request", route_to: "it-support", follow_up_after: "P3D",
    self_service: "/it-support/set-up-a-new-hire-laptop.md",
    fields: [
      { name: "for_whom", type: "email", required: true, label: "Who is the laptop for?" },
      { name: "reason", type: "select", required: true, options: ["New hire", "Replacement", "Broken"] },
      { name: "start_date", type: "date", required: false, label: "Start date, for new hires" },
      { name: "needs_accessories", type: "boolean", required: false },
    ],
    examples: ["I need a laptop for a new hire", "my laptop screen is broken", "can I get a replacement laptop"],
  },
}, `# What happens next

IT Support prepares the laptop within 3 working days. New hire laptops are ready on day one.

# Related

- [Onboarding](/_themes/onboarding.md)
`, { by: "human:tnguyen" });

note("it-support/request-types/report-an-lms-outage.md", {
  type: "Request Type", title: "Report an LMS outage", description: "Tell IT Support that the LMS is down or course pages will not load.",
  systems: ["lms"], themes: ["onboarding"], tags: ["outages"],
  extra: {
    kind: "incident", route_to: "it-support", follow_up_after: "PT4H",
    runbook: "/it-support/runbooks/lms-outage-response.md",
    fields: [
      { name: "what_happens", type: "text", required: true, label: "What do you see?" },
      { name: "course", type: "text", required: false, label: "Which course, if only one?" },
      { name: "students_affected", type: "number", required: false },
    ],
    examples: ["the LMS is down", "canvas won't load", "students can't open the course page"],
  },
}, `# What happens next

IT Support acknowledges within 30 minutes during working hours and posts updates on the
status page.

# Related

- [LMS](/_systems/lms.md)
`, { by: "human:tnguyen" });

note("it-support/runbooks/lms-outage-response.md", {
  type: "Runbook", title: "LMS outage response", description: "Diagnose and escalate an LMS outage, and keep instructors informed.",
  themes: ["onboarding"], systems: ["lms"], tags: ["outages"],
}, `# Trigger

Two or more reports that the LMS is down, or the uptime monitor alerts.

# Severity and escalation

Sev 2 during term. Escalate to the vendor after 30 minutes. Internal reference:
okapi-runbook-canary.

# Diagnosis

1. Check the vendor status page.
2. Try signing in from off the campus network.

# Resolution

1. Open a vendor ticket with the incident number.
2. Post an update on the status page every 30 minutes.

# Rollback

Not applicable.

# Related

- [LMS](/_systems/lms.md)
`, { by: "human:tnguyen" });

note("it-support/grant-lms-instructor-access.md", {
  type: "How-To", title: "Grant LMS instructor access", description: "Give an instructor or teaching assistant access to a course in the LMS.",
  themes: ["access-management"], systems: ["lms"], tags: ["access-requests"],
}, `# When to use this

When a course needs an extra instructor or teaching assistant that the SIS does not assign.

# Steps

1. Open the course in the LMS admin console.
2. Add the person with the Teacher or TA role.

# Related

- [LMS](/_systems/lms.md)
`, { by: "human:tnguyen" });

note("it-support/it-support-hours-and-contacts.md", {
  type: "Reference", title: "IT Support hours and contacts", description: "When IT Support is available and how to reach the on-call engineer.",
  themes: ["onboarding"], extra: { audience: "all-staff" },
}, `# Overview

IT Support answers requests Monday to Friday, 08:00 to 18:00.

# Details

| Channel | When |
| --- | --- |
| Desk | Working hours |
| On-call phone | Outages outside working hours |

# Related

- [Onboarding](/_themes/onboarding.md)
`, { by: "human:tnguyen" });

note("it-support/set-up-a-campus-printer.md", {
  type: "How-To", title: "Set up a campus printer", description: "Add a campus printer to a staff laptop.",
  themes: ["onboarding"], tags: ["laptops"],
}, `# When to use this

When a staff member cannot see a printer on their laptop.

# Steps

1. Open System Settings, Printers.
2. Add the printer by its asset tag, which is printed on its front panel.
`, { by: "human:tnguyen" });

note("it-support/troubleshoot-single-sign-on.md", {
  type: "How-To", title: "Troubleshoot single sign-on", description: "Fix the common reasons staff cannot sign in to company apps with single sign-on.",
  themes: ["access-management"], tags: ["passwords"],
}, `# When to use this

When a staff member sees an error from the identity provider while signing in.

# Steps

1. Ask for a screenshot of the error code.
2. For an expired password, follow [Reset a staff password](/it-support/reset-a-staff-password.md).
3. For a missing app assignment, add the app in the identity provider.

# Related

- [Access management](/_themes/access-management.md)
`, { by: "human:tnguyen" });

// ------------------------------------------------------------------------------------------------
// People Ops (restricted)

note("people-ops/onboard-a-new-employee.md", {
  type: "Process", title: "Onboard a new employee", description: "Everything that happens between a signed offer and the end of a new employee's first week.",
  themes: ["onboarding"], tags: ["new-hires"],
}, `# Overview

People Ops coordinates onboarding. IT, the hiring manager, and Finance each own a step.

# Roles

- People Ops: contract, payroll setup, and first-day schedule.
- IT Support: accounts and [a laptop](/it-support/set-up-a-new-hire-laptop.md).
- Hiring manager: first-week plan.

# Steps

1. Offer signed: People Ops creates the employee record.
2. Five days before start: IT prepares accounts and the laptop.
3. Day one: welcome session and the [leave policy](/people-ops/leave-policy.md) briefing.

# Related

- [Onboarding](/_themes/onboarding.md)
`, { by: "human:egarcia" });

note("people-ops/payroll-calendar.md", {
  type: "Reference", title: "Payroll calendar", description: "Payroll cut-off and pay dates for the year.",
  themes: ["month-end-close"], systems: ["netsuite"], tags: ["payroll"],
}, `# Overview

Payroll runs monthly. Changes after the cut-off move to the next month.
Internal marker: zebra-payroll-canary.

# Details

| Month | Cut-off | Pay date |
| --- | --- | --- |
| September | 18 Sep | 25 Sep |
| October | 16 Oct | 23 Oct |

# Related

- [Month-end close](/_themes/month-end-close.md)
`, { by: "human:egarcia" });

note("people-ops/request-a-payroll-correction.md", {
  type: "How-To", title: "Request a payroll correction", description: "What to do when a payslip is wrong.",
  themes: ["month-end-close"], tags: ["payroll"],
}, `# When to use this

When your payslip shows the wrong amount, hours, or deductions.

# Steps

1. Check the [payroll calendar](/people-ops/payroll-calendar.md) for the next cut-off.
2. Email People Ops with the payslip and what you expected.

# Related

- [Month-end close](/_themes/month-end-close.md)
`, { by: "human:egarcia" });

note("people-ops/leave-policy.md", {
  type: "Policy", title: "Leave policy", description: "Annual, sick, and parental leave entitlements for employees.",
  themes: ["onboarding"], tags: ["leave"],
}, `# Policy

Employees get 20 days of annual leave, 10 days of paid sick leave, and 16 weeks of
parental leave.

# Scope

All employees. Contractors follow their contract.

# Exceptions

Unused annual leave above 5 days does not carry over.

# Related

- [Onboarding](/_themes/onboarding.md)
`, { by: "human:egarcia" });

note("people-ops/offboard-an-employee.md", {
  type: "How-To", title: "Offboard an employee", description: "Remove access and recover equipment when an employee leaves.",
  themes: ["access-management", "onboarding"], tags: ["new-hires"],
}, `# When to use this

When an employee's last day is confirmed.

# Steps

1. Tell IT the last day so accounts are disabled at 18:00 that day.
2. Collect the laptop and badge.
3. Process the final pay before the [payroll](/people-ops/payroll-calendar.md) cut-off.

# Related

- [Access management](/_themes/access-management.md)
`, { by: "human:egarcia" });

note("people-ops/audit-payroll-quarterly.md", {
  type: "Decision", title: "Audit payroll every quarter", description: "Why People Ops and Finance reconcile payroll to the ledger every quarter.",
  themes: ["month-end-close"], systems: ["netsuite"], tags: ["payroll", "reconciliation"],
}, `# Context

In 2025 a payroll mapping error went unnoticed for four months.

# Decision

People Ops and Finance reconcile payroll to the NetSuite ledger at the end of each quarter.

# Consequences

The quarter-end close has an extra step owned by People Ops.

# Related

- [Month-end close](/_themes/month-end-close.md)
`, { by: "human:egarcia" });

// ------------------------------------------------------------------------------------------------
// Configuration

files[".kb/profile.yaml"] = `# Vault profile for Acme. See TECH_STACK section 5.
schema_version: 1
title: Acme knowledge base
okf_version: "0.2"
bundle_root: kb
id_prefix: kb_
required: [type, title, description, id, version, themes]
limits: { words_warn: 1200, words_error: 2500, max_tags: 8, max_themes: 3, image_max_mb: 2 }
types:
  How-To:          { review_days: 180, desk: answer }
  Process:         { review_days: 180, desk: answer }
  Explanation:     { review_days: 365, desk: answer }
  Reference:       { review_days: 365, desk: answer }
  Policy:          { review_days: 365, desk: answer }
  Decision:        { desk: answer }
  Runbook:         { review_days: 180, desk: team }
  Request Type:    { review_days: 365, desk: intake }
  Action:          { review_days: 180, desk: none }
  Theme:           { desk: navigate }
  System:          { review_days: 365, desk: navigate }
  Source Document: { desk: none, word_limits: false }
  Graph Report:    { desk: none, word_limits: false }
teams: [admissions-ops, finance-systems, it-support, people-ops]
custom_fields:
  - { name: audience, type: enum, values: [all-staff, managers, faculty], required: false }
link_style: absolute
`;

files[".kb/namespaces.yaml"] = `admissions:
  title: Admissions
  description: Applications, admission decisions, and student enrollment.
  owner: admissions-ops
  visibility: company
  publishing: manual
finance:
  title: Finance
  description: Deposits, refunds, the general ledger, and the monthly close.
  owner: finance-systems
  visibility: company
  publishing: manual
it-support:
  title: IT Support
  description: Accounts, devices, the LMS, and integrations run by IT.
  owner: it-support
  visibility: company
  publishing: auto
people-ops:
  title: People Ops
  description: Employment, payroll, and leave. Restricted to People Ops and managers.
  owner: people-ops
  visibility: restricted
  publishing: manual
  ai_processing: false
`;

files[".kb/tags.yaml"] = `# Governed tags. Aliases are rewritten to the canonical tag by kb lint --fix.
access-requests: { description: Requests to grant or change system access., aliases: [access-request] }
accounts-payable: { description: Vendor bills and payments., aliases: [ap] }
applications: { description: Admission applications and their review., aliases: [] }
deposits: { description: Enrollment deposits and how they are recorded., aliases: [] }
duplicates: { description: Duplicate records and how to prevent or merge them., aliases: [duplicate-records] }
enrollment-status: { description: Enrollment status values and transitions., aliases: [] }
laptops: { description: Staff laptops and other devices., aliases: [laptop, devices] }
leave: { description: Annual, sick, and parental leave., aliases: [] }
new-hires: { description: People joining the company., aliases: [new-hire] }
new-students: { description: First-time students., aliases: [] }
outages: { description: Service outages and incidents., aliases: [outage, downtime] }
passwords: { description: Passwords and sign-in problems., aliases: [password] }
payroll: { description: Payroll runs, payslips, and corrections., aliases: [] }
reconciliation: { description: Matching one set of records to another during the close., aliases: [] }
refunds: { description: Refunds to students., aliases: [refund] }
returning-students: { description: Former students who enroll again., aliases: [re-enrollment, returning-student] }
security: { description: Security controls and policies., aliases: [] }
sync: { description: Integrations that copy data between systems., aliases: [integration] }
`;

files["kb/log.md"] = `# Vault log

## 2026-06-01

- Created the vault with namespaces admissions, finance, it-support, and people-ops.
`;

// ------------------------------------------------------------------------------------------------
// Golden questions (Plans 3 and 4). Paths are resolved to ids when written.

const Q = (q, intent, expect = {}) => ({ q, intent, ...expect });
const questions = [
  Q("How do I re-enroll a student who left last year?", "question", { notes: ["admissions/enroll-a-returning-student-in-salesforce"] }),
  Q("re-enroll returning student", "question", { notes: ["admissions/enroll-a-returning-student-in-salesforce"] }),
  Q("How do I enroll a student who has never studied here?", "question", { notes: ["admissions/enroll-a-new-student"] }),
  Q("There are two Salesforce contacts for the same student, what do I do?", "question", { notes: ["admissions/clean-up-duplicate-contacts", "admissions/merge-duplicate-student-records"] }),
  Q("Why do we match students by student ID?", "question", { notes: ["admissions/use-the-student-id-as-the-primary-key"] }),
  Q("What does the enrollment status RTRN mean?", "question", { notes: ["admissions/enrollment-status-codes"] }),
  Q("When does an enrollment become Confirmed?", "question", { notes: ["admissions/how-enrollment-statuses-work", "finance/how-deposits-flow-from-salesforce-to-netsuite"] }),
  Q("Who is the second reader for borderline applications?", "question", { notes: ["admissions/admissions-application-review"] }),
  Q("Do we accept unofficial transcripts?", "question", { notes: ["admissions/transcript-evaluation-policy"] }),
  Q("An applicant wants to know what is happening with their application", "question", { notes: ["admissions/check-an-applications-status"] }),
  Q("How do I prepare new student orientation?", "question", { notes: ["admissions/run-new-student-orientation"] }),
  Q("A student never got the enrollment confirmation email", "question", { notes: ["admissions/actions/resend-enrollment-confirmation"] }),
  Q("How do I record a deposit paid by bank transfer?", "question", { notes: ["finance/post-an-enrollment-deposit"] }),
  Q("How do online deposits get into NetSuite?", "question", { notes: ["finance/how-deposits-flow-from-salesforce-to-netsuite"] }),
  Q("What NetSuite roles are there?", "question", { notes: ["finance/netsuite-access-levels"] }),
  Q("What happens on day 3 of the close?", "question", { notes: ["finance/month-end-close-process", "finance/accrue-unbilled-revenue"] }),
  Q("How do I reconcile the bank accounts at month end?", "question", { notes: ["finance/reconcile-bank-accounts"] }),
  Q("Which journal entry code do I use for accruals?", "question", { notes: ["finance/netsuite-journal-entry-codes"] }),
  Q("Can a student get their deposit back if they withdraw?", "question", { notes: ["finance/refund-policy"] }),
  Q("How do I refund a student who withdrew?", "question", { notes: ["finance/issue-a-student-refund"] }),
  Q("How do I approve a vendor bill?", "question", { notes: ["finance/approve-vendor-invoices"] }),
  Q("How does the SIS sync work?", "question", { notes: ["it-support/how-the-sis-to-salesforce-sync-works"] }),
  Q("How do I reset someone's password?", "question", { notes: ["it-support/reset-a-staff-password"] }),
  Q("Can I use SMS codes for MFA?", "question", { notes: ["it-support/multi-factor-authentication-policy"] }),
  Q("What are IT Support's hours?", "question", { notes: ["it-support/it-support-hours-and-contacts"] }),
  Q("I can't sign in with single sign-on", "question", { notes: ["it-support/troubleshoot-single-sign-on"] }),
  Q("How do I add a TA to my course in the LMS?", "question", { notes: ["it-support/grant-lms-instructor-access"] }),
  Q("How many days of annual leave do I get?", "question", { notes: ["people-ops/leave-policy"], restricted: true }),
  Q("When is the payroll cut-off in October?", "question", { notes: ["people-ops/payroll-calendar"], restricted: true }),
  Q("My payslip is wrong", "question", { notes: ["people-ops/request-a-payroll-correction"], restricted: true }),
  Q("I need access to NetSuite", "request", { requestType: "finance/request-types/request-access-to-netsuite" }),
  Q("can you give my new hire NetSuite AP access", "request", { requestType: "finance/request-types/request-access-to-netsuite" }),
  Q("NetSuite says I don't have permission to approve bills", "request", { requestType: "finance/request-types/request-access-to-netsuite" }),
  Q("I need a laptop for someone starting Monday", "request", { requestType: "it-support/request-types/request-a-laptop" }),
  Q("my laptop screen cracked, can I get a new one", "request", { requestType: "it-support/request-types/request-a-laptop" }),
  Q("the LMS is down", "incident", { requestType: "it-support/request-types/report-an-lms-outage" }),
  Q("students can't open the course page in canvas", "incident", { requestType: "it-support/request-types/report-an-lms-outage" }),
  Q("where is the enrollment hub", "navigation", { notes: ["_themes/enrollment"] }),
  Q("whats the weather tomorrow", "off_topic"),
  Q("write me a poem about spreadsheets", "off_topic"),
];

const idOf = (slug) => FIXED_IDS[slug] ?? idFor(slug);
files[".kb/eval/questions.yaml"] =
  "# Golden questions for retrieval and routing evaluation (TECH_STACK 10.4).\n" +
  "# restricted: true marks questions only people-ops readers should get an answer to.\n" +
  questions
    .map((q) => {
      const lines = [`- q: ${JSON.stringify(q.q)}`, `  intent: ${q.intent}`];
      if (q.notes) lines.push(`  expect_notes: [${q.notes.map(idOf).join(", ")}]`);
      if (q.requestType) lines.push(`  expect_request_type: ${idOf(q.requestType)}`);
      if (q.restricted) lines.push(`  restricted: true`);
      return lines.join("\n");
    })
    .join("\n") +
  "\n";

rmSync(ROOT, { recursive: true, force: true });
for (const [path, content] of Object.entries(files)) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
console.log(`Wrote ${Object.keys(files).length} files to ${ROOT}`);
