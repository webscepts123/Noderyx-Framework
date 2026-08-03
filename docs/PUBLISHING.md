# Publishing Noderyx through GitHub Actions

The npm release workflow uses Trusted Publishing with OpenID Connect. It does
not store an `NPM_TOKEN` in GitHub.

## npm Trusted Publisher values

Enter these exact values in the npm package settings:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `webscepts123` |
| Repository | `Noderyx-Framework` |
| Workflow filename | `npm-publish.yml` |
| Environment name | `npm` |
| Allowed action | Allow `npm publish` |

The workflow file must already exist on the repository's default branch before
saving the npm connection.

## Publish a release

1. Update `version` in both `package.json` and `package-lock.json`.
2. Commit and push the release changes.
3. Create a GitHub release whose tag is exactly `v<version>`, such as `v0.4.0`.
4. Publish the GitHub release.

The workflow refuses a mismatched tag, installs exact locked dependencies,
runs all tests and the QA audit, previews the package contents, and publishes
from a GitHub-hosted runner using a short-lived OIDC credential. Trusted
publishing automatically adds npm provenance for a public package from a public
repository.

For stronger release governance, configure the GitHub `npm` environment with
required reviewers and protect release tags. After the first successful OIDC
publish, npm recommends setting publishing access to require 2FA and disallow
traditional tokens, then revoking unused automation tokens.
