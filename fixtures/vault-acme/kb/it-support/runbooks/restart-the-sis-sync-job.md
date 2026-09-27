---
type: Runbook
title: Restart the SIS sync job
description: Restart the Salesforce to SIS enrollment sync after a failed or stuck run.
id: kb_01J9Z1BSQ32PH1RZXXZ2ZHJ5WA
version: 1.0.0
themes: [enrollment]
systems: [sis, salesforce]
tags: [sync]
generated: { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
stale_after: 2027-01-30T09:00:00Z
---

# Trigger

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
