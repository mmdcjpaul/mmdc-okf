---
type: Request Type
title: Request a laptop
description: Ask IT Support for a new or replacement laptop.
id: kb_01J9ZZJXRYEZE3Q7X5V6B21F02
version: 1.0.0
themes: [onboarding]
tags: [laptops]
generated: { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
stale_after: 2027-08-03T09:00:00Z
kind: request
route_to: it-support
follow_up_after: P3D
self_service: /it-support/set-up-a-new-hire-laptop.md
fields:
  - { name: for_whom, type: email, required: true, label: Who is the laptop for? }
  - { name: reason, type: select, required: true, options: [New hire, Replacement, Broken] }
  - { name: start_date, type: date, required: false, label: "Start date, for new hires" }
  - { name: needs_accessories, type: boolean, required: false }
examples: [I need a laptop for a new hire, my laptop screen is broken, can I get a replacement laptop]
---

# What happens next

IT Support prepares the laptop within 3 working days. New hire laptops are ready on day one.

# Related

- [Onboarding](/_themes/onboarding.md)
