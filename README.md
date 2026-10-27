# Public Bible JSON dataset

This repository is an infrastructure scaffold for a public-domain Bible text
dataset. It currently contains no Bible text and is not a data release. No
release tag should be created until the source, rights, complete data, and
validation have all been confirmed.

## Planned dataset

The planned versions are:

| ID | Name | License |
|---|---|---|
| `kjv` | King James Version | Public domain; source and territorial status must be verified |
| `web` | World English Bible | Public domain; source and retrieval date must be recorded |

See [DATA-LICENSES.md](./DATA-LICENSES.md) for the current source status.

## Fetching data

After a version is released, consumers can fetch a chapter using:

```text
https://cdn.jsdelivr.net/gh/<OWNER>/<REPO>@<TAG>/data/<version>/<book>/<chapter>.json
```

For example, the planned KJV chapter request for Ruth 1 is:

```text
https://cdn.jsdelivr.net/gh/<OWNER>/<REPO>@v1.0.0/data/kjv/ruth/1.json
```

The example URL is not available until a complete release exists. Consumers
must pin to a tag.

## Format

The root `index.json` lists available versions. Each version has an index of
books, and each book has one JSON file per chapter. A chapter contains
consecutive numbered verses with plain text. Optional headings and verse flags
are described in the schemas:

- [Version schema](./schema/version.schema.json)
- [Book index schema](./schema/book.schema.json)
- [Chapter schema](./schema/chapter.schema.json)

## Scripts and validation

The scripts run in development and GitHub Actions only; this repository does
not require a server runtime.

```sh
npm ci
npm test
npm run generate -- kjv /path/to/normalized-source.json
npm run validate
```

The generator accepts a JSON source file with a `version` matching the target
and a `books` array. Each book must provide `id`, `name`, `shortName`,
`testament`, and `chapters`; each chapter must provide a `chapter` number and
`verses` containing `n` and `text`.
Generation writes only under `data/<version>/`. Keep source files outside this
repository.

The full validator requires both versions and enforces 66 books, 1,189
chapters, and 31,102 verses per version. Until the source data has been
verified and added, CI runs the infrastructure tests only; this scaffold is
not release-ready.
