# Changelog

## Unreleased

- Added the initial schemas, source generator, dataset validator, tests, and CI
  scaffold.
- No Bible text is included. No dataset release or version tag has been made.
- Validator now also rejects HTML entities, USFM markers, verse-number
  prefixes, control characters, and stray whitespace in text, and lists the
  error count.
- Added `--tag vX.Y.Z` release check (datasetVersion and CHANGELOG entry) and a
  CI step that runs it on tag pushes.
- Generator shares text rules with the validator, normalizes whitespace, and
  clears `data/<version>/` before writing so no stale files remain.
- Schemas: `headings` must be non-empty when present; `language` must be a
  BCP 47-style code.
- Added tests for the new rules and a check that no out-of-scope translation
  is present in the repository.
