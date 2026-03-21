# eta-mu-github

Pi-based GitHub automation for PRs, issues, and review coordination.

## Goals

- Give the GitHub automation surface a stable bot identity: **eta-mu**
- Trigger on PR changes, issue creation, and explicit mentions
- Debounce noisy event bursts with GitHub Actions concurrency groups
- Interact with CodeRabbit, other review agents, and humans via issue/PR comments
- Provide a review gate for unresolved review threads from configured actors

## What is here

- `eta-mu review-gate` — fails when unresolved review threads exist for configured actors (defaults to CodeRabbit)
- `eta-mu run-event` — classifies an event, builds GitHub context, runs a pi session, and posts or updates an eta-mu comment when appropriate
- workflow templates under `templates/workflows/`
- GitHub App setup notes under `docs/github-app.md`

## CLI

```bash
pnpm dev review-gate --repo open-hax/voxx --pr 1
pnpm dev run-event --repo open-hax/voxx --event-name issue_comment --event-path /tmp/event.json --cwd /path/to/repo
```

## GitHub workflow model

Each target repository keeps a tiny local wrapper workflow that:

1. checks out the target repo
2. checks out `open-hax/eta-mu-github`
3. installs eta-mu dependencies
4. runs either `review-gate` or `run-event`

This preserves stable, repo-local check names for branch protection while keeping the logic centralized in this repo.

## Verification

```bash
pnpm test
pnpm build
```
