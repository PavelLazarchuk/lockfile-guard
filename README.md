# lockfile-guard

[![npm version](https://img.shields.io/npm/v/lockfile-guard.svg)](https://www.npmjs.com/package/lockfile-guard)
[![npm downloads](https://img.shields.io/npm/dm/lockfile-guard.svg)](https://www.npmjs.com/package/lockfile-guard)

`npm audit` answers "is there a known CVE?". This answers a different question: **what changed between these two lockfiles, and should a human look at it?**

A dependency bump can quietly add a `postinstall` script, be published by an account that never published this package before, resolve to a registry that is not npm, or drag in a transitive package that nobody has ever downloaded. None of that is a CVE, so nothing in the default toolchain says a word about it.

```sh
npx lockfile-guard --base base-lock.json --head package-lock.json
```

```md
## 🔒 lockfile-guard

**3 findings** across 41 dependency changes — 1 critical, 2 high.

### 🛑 critical

| Package             | Rule              | Evidence                                                                         |
| ------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `tiny-helper@2.0.0` | registry-mismatch | resolves to https://evil-registry.example.com, not to https://registry.npmjs.org |

### 🔴 high

| Package              | Rule                 | Evidence                                                 |
| -------------------- | -------------------- | -------------------------------------------------------- |
| `esbuild@0.25.0`     | install-script-added | postinstall: node install.js                             |
| `event-stream@4.0.1` | publisher-changed    | published by right9ctrl, previous version by dominictarr |
```

No account, no SaaS, no configuration file needed. It runs on the two lockfiles you already have.

## The GitHub Action

```yaml
# .github/workflows/lockfile-guard.yml
name: lockfile-guard

on: pull_request

permissions:
    contents: read
    pull-requests: write

jobs:
    guard:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
              with:
                  fetch-depth: 0

            - uses: PavelLazarchuk/lockfile-guard@v1
              with:
                  lockfile: package-lock.json
                  fail-on: high
```

The base lockfile is read with `git show origin/$BASE_REF:<lockfile>`, not through the API, so the action works in pull requests from forks where the token cannot read much. The comment is sticky: one comment per pull request, edited in place, found by the `<!-- lockfile-guard -->` marker. A pull request that changes no dependency gets no comment at all — though an existing one is still corrected, so it never sits there saying something stale.

| Input      | Default                        | What it does                                           |
| ---------- | ------------------------------ | ------------------------------------------------------ |
| `lockfile` | `package-lock.json`            | Head lockfile, relative to the repository root         |
| `base-ref` | the pull request's base branch | Branch to diff against                                 |
| `fail-on`  | `high`                         | Lowest severity that fails the job (`none` never does) |
| `format`   | `markdown`                     | `markdown`, `json` or `sarif`                          |
| `output`   | —                              | Write the report to a file instead of the step log     |
| `comment`  | `true`                         | Post or update the sticky pull-request comment         |
| `offline`  | `false`                        | Skip every rule that needs the registry                |
| `config`   | —                              | Path to a `lockfile-guard.config.json`                 |
| `args`     | —                              | Extra CLI arguments, appended verbatim                 |
| `version`  | `latest`                       | Version of the CLI to run                              |

### SARIF and Code Scanning

```yaml
- uses: PavelLazarchuk/lockfile-guard@v1
  with:
      format: sarif
      output: lockfile-guard.sarif
      fail-on: none

- uses: github/codeql-action/upload-sarif@v3
  with:
      sarif_file: lockfile-guard.sarif
```

## Rules

| Rule                     | Severity | Network | What it reports                                                            |
| ------------------------ | -------- | ------- | -------------------------------------------------------------------------- |
| `registry-mismatch`      | critical | no      | A resolution points at a registry that is not on the allowlist             |
| `integrity-missing`      | high     | no      | A registry tarball with no integrity hash                                  |
| `install-script-added`   | high     | yes     | `preinstall`/`install`/`postinstall` that the previous version did not run |
| `publisher-changed`      | high     | yes     | A different npm account published the new version                          |
| `maintainers-changed`    | medium   | yes     | The maintainer list gained or lost someone                                 |
| `version-too-fresh`      | medium   | yes     | The new version was published less than 24 hours ago                       |
| `new-obscure-transitive` | medium   | yes     | A new transitive dependency under 100 weekly downloads                     |
| `new-young-transitive`   | medium   | yes     | A new transitive package first published recently (needs `--strict-age`)   |
| `deprecated`             | low      | yes     | The new version is deprecated on the registry                              |
| `new-transitive`         | low      | no      | A new transitive dependency entered the tree                               |

Two design decisions matter more than the list itself.

**The evidence is the thing, not the alert.** `postinstall: node install.js` is a second of review. "This package has an install script" is a research task. Every rule reports the actual command, account, registry or count it objected to.

**The defaults are quiet.** `new-transitive` is `low` and sits below the default `fail-on: high`, so a routine Dependabot bump does not fail anything. A rule that fires on every pull request gets switched off within a week, and then it is worth nothing.

### Why `publisher-changed` is trustworthy

The version document — `GET registry.npmjs.org/<name>/<version>` — is frozen at publish time. `event-stream@3.3.4` still says `dominictarr`; `event-stream@4.0.1` says `right9ctrl`; today's packument says the package belongs to `npm`. Comparing the base version's document against the head version's document asks exactly the right question and is not confused by who owns the package now.

## The allowlist, with zero configuration

The default registry allowlist is `https://registry.npmjs.org` **plus every origin the base lockfile already resolved to**. An internal mirror that is already in use is therefore not a finding; a resolution that moved somewhere new is. Add more with `--registry` or the config file.

## CLI

```sh
lockfile-guard --base base-lock.json --head package-lock.json
lockfile-guard --base base-lock.json --head pnpm-lock.yaml --fail-on critical
lockfile-guard --base base-lock.json --head package-lock.json --offline
lockfile-guard --base base-lock.json --head package-lock.json --format sarif -o report.sarif
```

| Option                       | Default                      |                                                 |
| ---------------------------- | ---------------------------- | ----------------------------------------------- |
| `--base <file>`              | —                            | Lockfile from the target branch                 |
| `--head <file>`              | —                            | Lockfile from the pull request                  |
| `--format <kind>`            | `markdown`                   | `markdown`, `json`, `sarif`                     |
| `-o, --output <file>`        | stdout                       | Where the report goes                           |
| `--fail-on <severity>`       | `high`                       | `critical`, `high`, `medium`, `low`, `none`     |
| `--offline`                  | off                          | Only the rules that need no registry            |
| `--strict-age`               | off                          | Also date new transitives through the packument |
| `--registry <url>`           | npm                          | Allowlist a registry (repeatable)               |
| `--ignore <glob>`            | —                            | Ignore packages by name (repeatable)            |
| `--freshness-hours <n>`      | `24`                         | `version-too-fresh` threshold                   |
| `--min-weekly-downloads <n>` | `100`                        | `new-obscure-transitive` threshold              |
| `--concurrency <n>`          | `8`                          | Parallel registry requests                      |
| `--timeout <ms>`             | `10000`                      | Per-request timeout                             |
| `--cache-dir <path>`         | `~/.cache/lockfile-guard`    | ETag cache location                             |
| `--no-cache`                 | off                          | Do not read or write the cache                  |
| `--fail-on-network-error`    | off                          | Treat a registry failure as a failed run        |
| `--github-comment`           | off                          | Post or update the sticky pull-request comment  |
| `--config <file>`            | `lockfile-guard.config.json` | Config file                                     |

Exit codes: **0** clean · **1** findings at or above `--fail-on` · **2** the run itself failed. A finding and a broken run are never the same exit code.

## Configuration

Everything is optional. The file is JSON with comments allowed.

```jsonc
// lockfile-guard.config.json
{
    "registries": ["https://registry.npmjs.org", "https://npm.internal.example.com"],
    "freshnessHours": 24,
    "minWeeklyDownloads": 100,
    "ignore": ["@my-org/**"],
    "failOn": "high",
    "rules": {
        "deprecated": "off",
        "new-transitive": "medium",
    },
}
```

Each rule takes `off` or a severity that replaces its default.

## Lockfiles it reads

- `package-lock.json` / `npm-shrinkwrap.json`, `lockfileVersion` 2 and 3 (npm 7+), including workspaces
- `pnpm-lock.yaml`, schema versions 5.4, 6.0 and 9.0

Paths move constantly — a hoist, a dedupe, one new peer and half the tree shifts a level. The differ matches by path first and then by name, so a bump that also relocated a package reads as `version-changed` rather than as an unrelated add and remove.

## Private registries

Credentials are read from `.npmrc` (project first, then `~/.npmrc`), including registry-scoped `//registry.example.com/:_authToken=` entries and `${ENV_VAR}` expansion. A token never reaches the report: every string that leaves the network layer is scrubbed, and there is a test that says so.

Only registries on the allowlist are ever contacted. A package resolving anywhere else is reported by `registry-mismatch` and never fetched.

## Network behaviour

- One request per changed package (two for a bump: base version and head version), ~1–2.5 KB each. Packuments are avoided — `typescript`'s is 2 MB, and its version document is 1.5 KB.
- Publish dates come off a ladder: 19 bytes of `dist-tags`, then a ~1 KB search hit when the bumped version is `latest`, and only otherwise the full packument.
- Version documents are immutable, so responses are cached on disk with their ETag and revalidated once a day (`deprecated` is the one field that gets rewritten in place).
- A registry that is down produces a warning in the report and exit code 0, not a broken pipeline. `--fail-on-network-error` inverts that.

## Programmatic use

```ts
import { analyze, DEFAULT_CONFIG, formatMarkdown } from 'lockfile-guard';

const report = await analyze({
    base: { source: baseSource, filename: 'package-lock.json' },
    head: { source: headSource, filename: 'package-lock.json' },
    config: { ...DEFAULT_CONFIG, offline: true },
});

console.log(formatMarkdown(report));
```

## Compared with

- **`npm audit`** — known CVEs in what you have. Says nothing about what changed.
- **`lockfile-lint`** — validates URLs and protocols in the lockfile. Does not diff two of them.
- **Dependabot / `dependency-review-action`** — version and license policy. Not publishers, not install scripts, not freshness.
- **Socket** — the same question, answered well, as a paid SaaS with an account and an app installation. This is a CLI you can run in three seconds with `npx`.

## License

MIT
