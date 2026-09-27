---
type: Request Type
title: Request access to NetSuite
description: Ask Finance Systems to grant or change NetSuite access for a user.
id: kb_01J9Z7K2M4P6R8T0V2X4Z6B8C9
version: 1.0.0
themes: [access-management]
systems: [netsuite]
tags: [access-requests]
generated: { by: human:bchan, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:bchan, at: 2026-08-03T09:00:00Z }
stale_after: 2027-08-03T09:00:00Z
kind: request
route_to: finance-systems
follow_up_after: P2D
self_service: /finance/netsuite-access-levels.md
runbook: /finance/runbooks/grant-netsuite-access.md
fields:
  - { name: user_email, type: email, required: true, label: Who needs access? }
  - { name: role, type: select, required: true, options: [AP Clerk, AR Clerk, Viewer] }
  - { name: reason, type: text, required: true, label: What do they need it for? }
  - { name: needed_by, type: date, required: false }
examples: [I need access to NetSuite, can you give my new hire NetSuite AP access, NetSuite says I don't have permission to approve bills]
---

# What happens next

Finance Systems grants access within 2 working days after the requester's
manager approves the request in the ticket.

# Related

- [Access management](/_themes/access-management.md)
