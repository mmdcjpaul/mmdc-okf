---
type: How-To
title: Post an enrollment deposit
description: Record a student's enrollment deposit in NetSuite so the enrollment becomes Confirmed.
id: kb_01J9ZNC3WYHPNW67V0DP2SZPEV
version: 1.0.0
themes: [enrollment]
systems: [netsuite, salesforce]
tags: [deposits]
generated: { by: human:bchan, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:bchan, at: 2026-08-03T09:00:00Z }
stale_after: 2027-01-30T09:00:00Z
---

# When to use this

When a deposit arrives by bank transfer instead of the online payment page.

# Steps

1. Find the student's customer record in NetSuite by student ID.
2. Create a customer deposit for the amount received against the enrollment.
3. Check the next morning that the enrollment in Salesforce shows Confirmed.

# Related

- [Enrollment](/_themes/enrollment.md)
- [How deposits flow from Salesforce to NetSuite](/finance/how-deposits-flow-from-salesforce-to-netsuite.md)
