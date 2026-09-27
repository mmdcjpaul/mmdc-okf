---
type: Action
title: Resend the enrollment confirmation email
description: Re-sends the enrollment confirmation email for one enrollment record.
id: kb_01J9Z8A3C5E7G9H1K3M5N7P9Q2
version: 1.1.0
themes: [enrollment]
systems: [salesforce]
generated: { by: human:jlim, at: 2026-09-10T03:00:00Z }
verified:
  - { by: human:jlim, at: 2026-09-10T03:00:00Z }
stale_after: 2027-03-09T03:00:00Z
execution: auto
risk: low
approvers: []
runtime: http
parameters:
  - { name: enrollment_id, type: string, required: true }
executor:
  resource: gateway://salesforce/resend-enrollment-confirmation
  receipt: [ request_id, status, sent_at ]
---

# When to use

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
