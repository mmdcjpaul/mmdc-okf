---
type: How-To
title: Clean up duplicate contacts
description: Find and merge duplicate student contacts in Salesforce so each student has one record.
id: kb_01J9ZTN2VAKHSW04Z9NM0QKFKP
version: 1.0.0
themes: [enrollment]
systems: [salesforce]
tags: [duplicates]
generated: { by: human:mreyes, at: 2026-08-03T09:00:00Z }
verified:
  - { by: human:mreyes, at: 2026-08-03T09:00:00Z }
stale_after: 2027-01-30T09:00:00Z
---

# When to use this

Use this when the duplicate report shows two contacts for the same student, usually after
someone enrolled a returning student from the Enrollments tab.

# Steps

1. Open the Duplicate Contacts report in Salesforce.
2. Compare student ID, email, and date of birth. Only merge when the student ID matches.
3. Choose the older contact as the master record and merge.
4. Check that enrollments from both contacts now sit on the master record.

# Related

- [Salesforce](/_systems/salesforce.md)
- [Enroll a returning student in Salesforce](/admissions/enroll-a-returning-student-in-salesforce.md)
- [Use the student ID as the primary key](/admissions/use-the-student-id-as-the-primary-key.md)
