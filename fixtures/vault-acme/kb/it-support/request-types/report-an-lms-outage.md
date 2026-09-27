---
type: Request Type
title: Report an LMS outage
description: Tell IT Support that the LMS is down or course pages will not load.
id: kb_01J9ZPEQMCM3DN6N51KZFRSHCG
version: 1.0.0
themes: [onboarding]
systems: [lms]
tags: [outages]
generated: { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:tnguyen, at: 2026-08-03T09:00:00Z }
stale_after: 2027-08-03T09:00:00Z
kind: incident
route_to: it-support
follow_up_after: PT4H
runbook: /it-support/runbooks/lms-outage-response.md
fields:
  - { name: what_happens, type: text, required: true, label: What do you see? }
  - { name: course, type: text, required: false, label: "Which course, if only one?" }
  - { name: students_affected, type: number, required: false }
examples: [the LMS is down, canvas won't load, students can't open the course page]
---

# What happens next

IT Support acknowledges within 30 minutes during working hours and posts updates on the
status page.

# Related

- [LMS](/_systems/lms.md)
