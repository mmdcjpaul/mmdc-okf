---
type: System
title: SIS
description: "The student information system: the record of courses, grades, and student accounts."
id: kb_01J9Z71H68QNW60M604G9BFP7P
version: 1.0.0
aliases: [student information system]
generated: { by: human:mreyes, at: 2026-06-01T00:00:00Z }
verified:
  - { by: human:mreyes, at: 2026-06-01T00:00:00Z }
stale_after: 2027-06-01T00:00:00Z
---

# Overview

The SIS is the system of record for academic data. A nightly job syncs enrollments from Salesforce.

# Members

<!-- kb:members:start -->

## How-To

* [Enroll a returning student in Salesforce](/admissions/enroll-a-returning-student-in-salesforce.md) - Reactivate a former student's record and open a new enrollment without creating a duplicate contact.
* [Manage the course waitlist](/admissions/manage-the-course-waitlist.md) (draft) - Move waitlisted students into open seats in the order they joined.

## Explanation

* [How enrollment statuses work](/admissions/how-enrollment-statuses-work.md) - Why an enrollment moves through Pending, Confirmed, Active, and Closed, and what each status controls.
* [How the SIS to Salesforce sync works](/it-support/how-the-sis-to-salesforce-sync-works.md) - The nightly job that copies confirmed enrollments from Salesforce to the SIS and results back.

## Reference

* [Enrollment status codes](/admissions/enrollment-status-codes.md) - Every Enrollment__c status value in Salesforce with its SIS equivalent.

## Decision

* [Use the student ID as the primary key](/admissions/use-the-student-id-as-the-primary-key.md) - Why Salesforce and the SIS match students by student ID instead of name or email.

## Runbook

* [Restart the SIS sync job](/it-support/runbooks/restart-the-sis-sync-job.md) - Restart the Salesforce to SIS enrollment sync after a failed or stuck run.

## Source Document

* [SIS enrollment SOP (2025)](/admissions/references/sis-enrollment-sop-2025.md) - Extracted text of the 2025 SIS enrollment standard operating procedure.

<!-- kb:members:end -->
