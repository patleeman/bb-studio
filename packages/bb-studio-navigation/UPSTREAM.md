# Navigation upstream

Compared with BB commit `0baa605b32a00619c1d7e3f32be6553ebcf8244a`
(`desktop-v0.44.0`, `plugins/navigation`). Pin a stable release, not a
nightly commit, so the vendored code only uses APIs stable BB ships. Run this
from this package directory to check or refresh it:

```sh
node upstream/sync.mjs --upstream /path/to/bb --commit 0baa605b32a00619c1d7e3f32be6553ebcf8244a --check
node upstream/sync.mjs --upstream /path/to/bb --commit <new-commit>
```

The script reads the plugin's runtime source and tests into `source/`, follows
their `@/` imports through `packages/shared-ui/src` into `components/` and
`lib/` (with the plugin registry's host-backed icon), applies
`upstream/studio-hooks.patch` in a temporary directory, and stops before
writing if the patch conflicts. `--check` fails when the vendored files
differ. Review and update the patch, tests, and this commit before accepting
a newer BB commit. Studio-only files live in `source/app/studio/`.

## Intentional changes to upstream files

| File | Reason |
| --- | --- |
| `source/app.tsx` | Name the provider Studio Navigation. |
| `source/app/Navigation.tsx` | Draw rows from `useStudioNavigationItems`, and keep the rows it leaves out in place when saving a new order. |

The upstream tests in `source/app.test.tsx` run unchanged. Studio's own tests
are in `source/app/studio/StudioNavigation.test.tsx`.
