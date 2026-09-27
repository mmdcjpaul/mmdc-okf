---
type: How-To
title: Enroll a returning student in Salesforce
description: Reactivate a former student's record and open a new enrollment without creating a duplicate contact.
id: kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D
version: 1.2.0
themes: [enrollment]
systems: [salesforce, sis]
tags: [returning-students, duplicates]
owner: admissions-ops
aliases: [re-enroll a student, reactivate a student, re-enroll returning student]
resource: https://acme.lightning.force.com/lightning/o/Enrollment__c/home
generated: { by: human:mreyes, at: 2026-09-02T08:15:00Z }
verified:
  - { by: human:mreyes, at: 2026-09-02T08:15:00Z }
stale_after: 2027-03-01T08:15:00Z
sources:
  - { id: sis-sop, resource: /admissions/references/sis-enrollment-sop-2025.md, title: SIS enrollment SOP (2025) }
audience: all-staff
---

# When to use this

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
