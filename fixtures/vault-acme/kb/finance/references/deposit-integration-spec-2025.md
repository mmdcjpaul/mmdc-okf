---
type: Source Document
title: Deposit integration spec (2025)
description: Extracted text of the 2025 Salesforce to NetSuite deposit integration specification.
id: kb_01J9ZFAXTXTN0CSGNSQ97H0T4D
version: 1.0.0
systems: [salesforce, netsuite]
generated: { by: lore-ingest/claude-sonnet-5, at: 2026-09-20T06:00:00Z }
---

# Extracted text

Integration: Salesforce Payment__c to NetSuite Customer Deposit. Schedule: every 15 minutes.
Matching key: student ID. On success the NetSuite deposit number is written to Payment__c.External_Id__c.
