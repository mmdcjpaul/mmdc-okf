---
type: Explanation
title: How the SIS to Salesforce sync works
description: The nightly job that copies confirmed enrollments from Salesforce to the SIS and results back.
id: kb_01J9ZV6VTK9AWK6X16D6ZBTPYN
version: 1.0.0
themes: [enrollment]
systems: [sis, salesforce]
tags: [sync]
generated: { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
stale_after: 2027-08-03T09:00:00Z
---

# Overview

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
