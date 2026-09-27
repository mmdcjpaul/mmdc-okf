---
type: Runbook
title: Grant NetSuite access
description: How Finance Systems grants or changes a NetSuite role after the manager approves.
id: kb_01J9ZY1R7WVC22TCH6Z7R4FGVY
version: 1.0.0
themes: [access-management]
systems: [netsuite]
tags: [access-requests]
generated: { by: human:bchan, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:bchan, at: 2026-08-03T09:00:00Z }
stale_after: 2027-01-30T09:00:00Z
---

# Trigger

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
