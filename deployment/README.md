# Deploy from GitHub with one command

    bash ~/public_html/deployment/deploy.sh

Run it in cPanel > Terminal, over SSH, from a cron job, or from GitHub Actions.
It fetches the branch, replaces the application files, installs dependencies
when `package.json` changed, and restarts the application.

## First run

    bash ~/public_html/deployment/deploy.sh init

That writes `deployment/deploy.config`, which holds this account's repository,
branch, and token. A deploy never replaces it. Set `REPOSITORY="webscepts123/Noderyx-Framework"`,
then deploy:

    bash ~/public_html/deployment/deploy.sh

## Commands

    deploy      Default. Fetch, sync, install, restart.
    init        Write deployment/deploy.config.
    status      What is configured, and what the last deploy did.
    install     Install dependencies only.
    restart     Restart the application only.
    rollback    Restore the snapshot taken before the last deploy.
    logs        Last 50 lines of tmp/deploy.log.
    cron        Print the cron line for scheduled deploys.

Options: `--repo=owner/name`, `--branch=name`, `--node=/path/node`,
`--mode=passenger`, `--install`, `--no-install`, `--no-restart`, `--force`,
`--quiet`, `--dry-run`.

## What is never replaced

`.env`, `.htaccess`, `tmp/`, `node_modules/`, `storage/`,
`public/uploads/`, the `noderyx-*.php` browser tools, and
`deployment/deploy.config`. Add more in `KEEP` inside `deploy.config`.

A snapshot of the application, without `node_modules/` and `tmp/`, is taken
before every deploy and kept under `~/.noderyx/backups`. The three newest are
kept; `rollback` restores the latest.

## Private repositories

Create a fine-grained personal access token with read access to the repository
and put it in `deployment/deploy.config` as `GITHUB_TOKEN`. Keep the file at
`chmod 600`; `init` does that for you.

## Deploy on every push

Add `.github/workflows/deploy-cpanel.yml` to the repository:

    npx noderyx cpanel:deploy-script --workflow --branch=main

It runs this same command over SSH using the `CPANEL_HOST`, `CPANEL_USER`,
and `CPANEL_KEY` repository secrets. On an account without SSH, use the
webhook that `noderyx-deploy.php` prints instead.

## Scheduled deploys

    */30 * * * * /bin/bash "$HOME/public_html/deployment/deploy.sh" --quiet >/dev/null 2>&1

A run with nothing new to fetch only touches files that changed.

## After a deploy

Put anything else the site needs in `deployment/after-deploy.sh`; the script
runs it from the application root, with `NODE_BIN` set. Migrations belong
there:

    "$NODE_BIN" node_modules/.bin/noderyx migrate

Commit that file. It comes from the repository like the rest of the
application, so a change to it reaches the server with the next deploy.

## When it will not work

No `git`, `curl`, or `wget` on the account: use `noderyx-deploy.php` in a
browser. No `rsync`: files removed from the branch stay on disk, and the
script says so. No `npm`: upload `node_modules` once, and deploys keep it.
