---
type: Explanation
title: How deposits flow from Salesforce to NetSuite
description: The integration that turns online deposits in Salesforce into customer deposits in NetSuite.
id: kb_01J9ZANJBYJPDCA4XQW6G45W39
version: 1.0.0
themes: [enrollment]
systems: [salesforce, netsuite]
tags: [deposits, sync]
generated: { by: lore-ingest/claude-sonnet-5, at: 2026-09-20T06:00:00Z }
sources:
  - { id: deposit-spec, resource: /finance/references/deposit-integration-spec-2025.md, title: Deposit integration spec (2025) }
---

# Overview

Online deposits are captured in Salesforce and pushed to NetSuite every 15 minutes.[^deposit-spec]

# How it works

1. The payment page creates a Payment record on the enrollment in Salesforce.
2. The integration picks up new Payment records and creates a customer deposit in NetSuite.
3. NetSuite returns the deposit number, which is written back to Salesforce.
4. A workflow in Salesforce moves the enrollment to Confirmed.

Deposits received by bank transfer skip this flow and are entered by hand, see
[Post an enrollment deposit](/finance/post-an-enrollment-deposit.md).

# Related

- [NetSuite](/_systems/netsuite.md)

[^deposit-spec]: Deposit integration spec (2025)
