---
type: Decision
title: Use the student ID as the primary key
description: Why Salesforce and the SIS match students by student ID instead of name or email.
id: kb_01J9ZQ6RSPXB1C7H5QJ8YTWTRZ
version: 1.0.0
themes: [enrollment]
systems: [salesforce, sis]
tags: [duplicates]
generated: { by: human:mreyes, at: 2026-02-10T09:00:00Z }
verified:
  - { by: human:mreyes, at: 2026-02-10T09:00:00Z }
---

# Context

In 2024 matching by email created thousands of duplicate contacts when students changed
their email address.

# Decision

Salesforce and the SIS match students only by student ID. Returning students keep their ID.

# Consequences

Staff must always search by student ID first. Duplicates are cleaned up with
[Clean up duplicate contacts](/admissions/clean-up-duplicate-contacts.md).

# Related

- [Salesforce](/_systems/salesforce.md)
