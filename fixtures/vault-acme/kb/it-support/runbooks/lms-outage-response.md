---
type: Runbook
title: LMS outage response
description: Diagnose and escalate an LMS outage, and keep instructors informed.
id: kb_01J9ZKF0JKSAK5RMRKCYQJQ2KK
version: 1.0.0
themes: [onboarding]
systems: [lms]
tags: [outages]
generated: { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
stale_after: 2027-01-30T09:00:00Z
---

# Trigger

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
