# Tables import/export and Artifacts preview boundaries

## Scope and method

The package tests load the actual plugin factories in the pinned SDK's fake
plugin host. They invoke schema-validated registered RPCs and, for Artifacts,
the real `/content` HTTP route backed by SQLite. Inputs are temporary test
data; no artifacts or tables were created in a user's installation.

- [Tables handler tests](../../../../packages/bb-studio/src/modules/tables/src/import-export.test.ts)
- [Artifacts route tests](../../../../packages/bb-studio/src/modules/artifacts/src/server/preview-routes.test.ts)

## Reproduced and fixed

A UTF-8 BOM before a quoted CSV header prevented quote recognition. Importing
`BOM + "Name","Notes"` into a default table created an extra column whose
name included literal quotes (`"Name"`), and left the intended Name cell empty.
The regression failed through `importCsv` and `get` before the change.
`TableStore.importCsv` now removes only an initial BOM before parsing. An
interior BOM remains part of the cell value. This covers RPC, agent and CLI
imports without changing the shared clipboard parser or SDK contracts.

## Covered behaviors

Tables' four new tests cover header matching, quoted commas and doubled quotes,
embedded CRLF, Unicode, empty cells, and formula-like strings such as
`=SUM(1,2)`, `+123` and `@literal`. Those strings remain literal cell content in
Tables and are exported unchanged; the exporter does not add spreadsheet
formula escaping. A 1,207-row import/export compares the entire CSV and checks
the final query page. Unclosed quotes and oversized RPC input leave the
persisted table unchanged. Empty input, header-only input and wholly blank
records add no rows. A missing table's export fails explicitly.

Artifacts' 13 new cases cover Markdown, text, code, HTML, SVG, PNG, PDF-signature
handling and unsupported files through import, metadata, text and HTTP reads.
Known extensions override supplied MIME; a valid HTML MIME selects HTML for an
unknown extension; a MIME containing a header injection attempt falls back to
opaque bytes. Non-PDF content has `nosniff` and sandbox headers. The PDF test
checks the existing signature gate, not full PDF structural validation.
HTML quote instrumentation is present only in the requested preview; normal
downloads preserve original bytes. Filename path removal, Unicode attachment
names, zero-byte files, malformed Base64 and invalid names are checked.
Cross-artifact version reads and missing content return 404. Missing blobs
produce a null text response; deleted items disappear. A text file over 2 MiB
reports a truncated preview while its download retains every byte.

## Verification

```sh
pnpm --filter @bb-studio/studio-tables test
pnpm --filter @bb-studio/studio-tables typecheck
pnpm --filter @bb-studio/studio-tables build
pnpm --filter @bb-studio/artifacts test
pnpm --filter @bb-studio/artifacts typecheck
pnpm --filter @bb-studio/artifacts build
git diff --check
```

Final package totals: Tables 13 tests; Artifacts 66 tests. Both package
typechecks and builds pass. The SDK pin remains 0.5.29.

## Separate staged visual checks

These tests do not prove browser rendering, file-picker behavior, downloads
on disk, or native Quick Look. A staged BB should still exercise:

1. Import a BOM CSV through the file picker, inspect a multiline cell, and
   download/reopen the exported CSV. Check a spreadsheet application's handling
   of formula-like cells separately from Tables' literal-value behavior.
2. Render Markdown and source text with Unicode and long lines; verify the
   large-text truncation notice and full download affordance.
3. Open a valid multipage PDF, PNG and SVG; check fitting, zoom, scrolling and
   a corrupt image/PDF's visible failure state. Server byte preservation does
   not validate image decoding or the browser's PDF viewer.
4. Run a sandboxed HTML artifact and test selection-to-thread. Confirm the
   visible missing/deleted-artifact state and a Unicode download filename.

The fake host does not enforce HTTP authentication. These tests therefore do
not claim live session, browser-origin or multi-plugin UI integration coverage.
