---
type: Explanation
title: How enrollment statuses work
description: Why an enrollment moves through Pending, Confirmed, Active, and Closed, and what each status controls.
id: kb_01J9Z0AH1NMX67ASRTH1MM95SP
version: 1.0.0
themes: [enrollment]
systems: [salesforce, sis]
tags: [enrollment-status]
generated: { by: human:mreyes, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:mreyes, at: 2026-08-03T09:00:00Z }
stale_after: 2027-08-03T09:00:00Z
---

# Overview

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
