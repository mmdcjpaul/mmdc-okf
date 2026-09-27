---
type: Action
title: Issue a small refund
description: Refund up to 500 dollars to a student after a withdrawal.
id: kb_01J9ZH2CFEJP6GVN14TSK8NQEA
version: 1.0.0
themes: [enrollment]
systems: [netsuite]
tags: [refunds]
generated: { by: human:bchan, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:bchan, at: 2026-08-03T09:00:00Z }
stale_after: 2027-01-30T09:00:00Z
execution: approval
risk: medium
approvers: [finance-systems]
runtime: http
parameters:
  - { name: student_id, type: string, required: true }
  - { name: amount, type: number, required: true, description: "Refund amount in dollars, at most 500" }
  - { name: reason, type: enum, required: true, values: [withdrawal, overpayment, duplicate-payment] }
executor:
  resource: gateway://netsuite/issue-refund
  receipt: [ refund_id, status ]
---

# When to use

A student withdrew within the [refund policy](/finance/refund-policy.md) and the amount is at most 500 dollars.

# Manual procedure

1. Open the student's customer record in NetSuite.
2. Create a customer refund for the amount against the original payment.
3. Add the reason in the memo field.

# Rollback

Void the customer refund in NetSuite before the payment run.

# Related

- [NetSuite](/_systems/netsuite.md)
