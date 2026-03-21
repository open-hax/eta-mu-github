# Eta-mu GitHub App bootstrap

Eta-mu should use a GitHub App identity so comments appear as the app user (for example `app/eta-mu`) instead of `github-actions[bot]`.

## Recommended app settings

### Name / slug
- Name: `eta-mu`
- Slug: `eta-mu`

### Repository permissions
- Contents: read
- Issues: read & write
- Pull requests: read & write
- Metadata: read

### Subscribe to events
- `issues`
- `issue_comment`
- `pull_request`
- `pull_request_review`
- `pull_request_review_comment`

## Secrets expected by workflows

Store these in each target repository or an organization-level Actions secret set:

- `ETA_MU_APP_ID`
- `ETA_MU_APP_PRIVATE_KEY`

The workflow should mint an installation token with:

```yaml
- id: eta_mu_token
  uses: actions/create-github-app-token@v1
  with:
    app-id: ${{ secrets.ETA_MU_APP_ID }}
    private-key: ${{ secrets.ETA_MU_APP_PRIVATE_KEY }}
```

Then pass `${{ steps.eta_mu_token.outputs.token }}` as `GITHUB_TOKEN` to eta-mu.

## Merge policy note

Eta-mu does not replace GitHub branch protection. The intended model is:

- GitHub branch/ruleset requires review thread resolution
- optional required status check: `eta-mu-review-gate / coderabbit-review-gate`
- CodeRabbit status check remains required where installed

This makes the merge gate survive transient bot outages while still letting eta-mu provide richer coordination.
