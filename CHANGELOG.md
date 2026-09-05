# lockfile-guard

## 1.0.1

### Patch Changes

- 7bc6d21: Fix two bugs that made the tool misreport on real repositories.

    A git or directory resolution in a pnpm lockfile carries neither a tarball nor an integrity hash, so every one of them was reported as `integrity-missing` at high severity. The pnpm parser now records where such a package actually comes from, the way the npm parser already does, which silences the false positive and lets `registry-mismatch` judge it on the same terms.

    The composite action built its optional flags with `[ -n "$X" ] && args+=(...)` under `set -e`, so an empty `output` or `config` — the defaults — failed the step before the CLI ever ran.
