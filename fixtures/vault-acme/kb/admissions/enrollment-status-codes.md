---
type: Reference
title: Enrollment status codes
description: Every Enrollment__c status value in Salesforce with its SIS equivalent.
id: kb_01J9Z7TP1D2YGEXJ5A7AAGP76W
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

Use these values when filtering enrollment reports or reading sync errors.

# Details

| Salesforce status | SIS code | Meaning |
| --- | --- | --- |
| Pending | PEND | Created, no deposit yet |
| Confirmed | CONF | Deposit received |
| Active | ACTV | Term has started |
| Returning | RTRN | Former student re-enrolling |
| Closed | CLSD | Term ended or withdrawn |

# Related

- [Enrollment](/_themes/enrollment.md)
- [How enrollment statuses work](/admissions/how-enrollment-statuses-work.md)
