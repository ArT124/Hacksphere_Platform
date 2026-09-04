---
name: Release smoke validation
description: The prepublish gate for HackSphere's seeded API journey.
---

The release gate should run the isolated API smoke suite through the named `release-smoke` validation workflow before publishing.

**Why:** The suite provisions a temporary database and exercises seeded authentication plus core journeys, so regressions fail before a release without coupling production startup to test-only behavior.

**How to apply:** Keep the root release check and the named validation workflow aligned with the API package's smoke command whenever release validation changes.