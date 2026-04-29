# Contributing

This covers how to get set up, how we work, and what to expect when opening a PR.

## What you'll need

- Node.js >= 18
- npm >= 9
- A SonarCloud or SonarQube account with a read-only token

## Getting started

Once you have the repo, install dependencies and get a working scan running:

```bash
npm install
cp .env.example .env        # fill in your token
npm run setup               # walks you through config.json
npm run build
npm run validate-config     # make sure everything connects
npm run scan                # confirm it works end to end
```

## Day-to-day development

```bash
npm run dev         # watch mode — picks up changes as you save
npm test            # run tests once
npm run test:watch  # tests in watch mode
npm run lint        # ESLint
npm run validate    # build + test — run this before opening a PR
```

## Branching

| Branch | Use for |
|--------|---------|
| `main` | stable, always shippable |
| `feat/<name>` | new features |
| `fix/<name>` | bug fixes |
| `chore/<name>` | tooling, deps, docs |

Keep branches focused and short-lived. PRs go against `main`.

### Recommended branch protection for `main`

Protect `main` in **Settings → Branches → Add rule**:

- ✅ Require a pull request before merging
- ✅ Require at least 1 approving review
- ✅ Dismiss stale reviews when new commits are pushed
- ✅ Require status checks to pass (select the `validate` CI job)
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings

## Before you open a PR

- [ ] `npm run validate` passes locally
- [ ] New behaviour has test coverage
- [ ] No tokens or secrets are staged
- [ ] `config.json` and `.env` are not in the diff
- [ ] The PR description explains *why* the change is needed, not just what it does

## Adding a new metric source

The pattern is consistent across all sources — follow what's already there:

1. Create `src/<source>-collector.ts` — model it on `sonarqube-collector.ts`
2. Add the raw data type to `src/types.ts`
3. Wire it into `src/orchestrator.ts`
4. Add normalisation logic in `src/normaliser.ts`
5. Add tests in `test/<source>-collector.test.ts`

## Found a bug?

Open an issue using the bug report template. The more context you include upfront, the faster it gets resolved — especially Node.js version, OS, and any relevant log output (with tokens redacted).

## Credential safety

Never commit `.env` or `config.json` — both are gitignored. If you accidentally push a token, rotate it straight away and clean the history with `git filter-repo`.
