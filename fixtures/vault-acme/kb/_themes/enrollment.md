---
type: Theme
title: Enrollment
description: The student journey from application to an active enrollment, across admissions, finance, and IT.
id: kb_01J9Z2WW0FNXGEKJS3JD0Y32TP
version: 1.0.0
aliases: [enrolment, registration]
generated: { by: human:mreyes, at: 2026-06-01T00:00:00Z }
verified:
  - { by: human:mreyes, at: 2026-06-01T00:00:00Z }
---

# Overview

Enrollment covers everything from a submitted application to a student who can attend classes: admission decisions, deposits, the Salesforce enrollment record, and the SIS account. Each team documents its own part in its own namespace; this hub collects them.

# Members

<!-- kb:members:start -->

## How-To

* [Check an application's status](/admissions/check-an-applications-status.md) - Look up where an application is in review and what the applicant still needs to send.
* [Clean up duplicate contacts](/admissions/clean-up-duplicate-contacts.md) - Find and merge duplicate student contacts in Salesforce so each student has one record.
* [Enroll a new student](/admissions/enroll-a-new-student.md) - Create the contact and first enrollment for a student who has never studied here.
* [Enroll a returning student in Salesforce](/admissions/enroll-a-returning-student-in-salesforce.md) - Reactivate a former student's record and open a new enrollment without creating a duplicate contact.
* [Issue a student refund](/finance/issue-a-student-refund.md) - Refund a deposit or tuition payment to a student who withdrew.
* [Manage the course waitlist](/admissions/manage-the-course-waitlist.md) (draft) - Move waitlisted students into open seats in the order they joined.
* [Merge duplicate student records](/admissions/merge-duplicate-student-records.md) - Merge two Salesforce contacts that belong to the same student into one record.
* [Post an enrollment deposit](/finance/post-an-enrollment-deposit.md) - Record a student's enrollment deposit in NetSuite so the enrollment becomes Confirmed.
* [Run new student orientation](/admissions/run-new-student-orientation.md) - Prepare and run the orientation session for newly enrolled students.

## Process

* [Admissions application review](/admissions/admissions-application-review.md) - How an application moves from submitted to a decision, who reviews it, and how long each step takes.

## Explanation

* [How deposits flow from Salesforce to NetSuite](/finance/how-deposits-flow-from-salesforce-to-netsuite.md) - The integration that turns online deposits in Salesforce into customer deposits in NetSuite.
* [How enrollment statuses work](/admissions/how-enrollment-statuses-work.md) - Why an enrollment moves through Pending, Confirmed, Active, and Closed, and what each status controls.
* [How the SIS to Salesforce sync works](/it-support/how-the-sis-to-salesforce-sync-works.md) - The nightly job that copies confirmed enrollments from Salesforce to the SIS and results back.

## Reference

* [Enrollment status codes](/admissions/enrollment-status-codes.md) - Every Enrollment__c status value in Salesforce with its SIS equivalent.

## Policy

* [Refund policy](/finance/refund-policy.md) - When students get their deposit and tuition back after withdrawing.
* [Transcript evaluation policy](/admissions/transcript-evaluation-policy.md) - Which transcripts Admissions accepts and how foreign transcripts are evaluated.

## Decision

* [Use the student ID as the primary key](/admissions/use-the-student-id-as-the-primary-key.md) - Why Salesforce and the SIS match students by student ID instead of name or email.

## Runbook

* [Restart the SIS sync job](/it-support/runbooks/restart-the-sis-sync-job.md) - Restart the Salesforce to SIS enrollment sync after a failed or stuck run.

## Action

* [Issue a small refund](/finance/actions/issue-a-small-refund.md) - Refund up to 500 dollars to a student after a withdrawal.
* [Resend the enrollment confirmation email](/admissions/actions/resend-enrollment-confirmation.md) - Re-sends the enrollment confirmation email for one enrollment record.

## Source Document

* [SIS enrollment SOP (2025)](/admissions/references/sis-enrollment-sop-2025.md) - Extracted text of the 2025 SIS enrollment standard operating procedure.

<!-- kb:members:end -->
