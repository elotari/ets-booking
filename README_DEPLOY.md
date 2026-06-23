Deployment setup
================

This project includes a GitHub Actions workflow to deploy the repository to a remote host over SSH when branches `main` or `feature/**` are pushed.

Required GitHub repository secrets (Settings → Secrets):
- `DEPLOY_SSH_KEY` — private SSH key (PEM) for the deploy user (no passphrase recommended for CI).
- `DEPLOY_HOST` — host IP or domain.
- `DEPLOY_USER` — remote username.
- `DEPLOY_PATH` — remote target directory (absolute path).
- `DEPLOY_SSH_PORT` — (optional) SSH port, defaults to 22.

How it works
- On push, Actions checks out the repo, starts ssh-agent with `DEPLOY_SSH_KEY`, then runs `rsync` to copy repository files to the remote path.

Security notes
- Add the public key to the remote user's `~/.ssh/authorized_keys`.
- Limit the deploy user's permissions on the host if possible.

Local auto-push
- `scripts/git-auto-push.sh` — POSIX shell script to commit and push changes.
- `scripts/git-auto-push.ps1` — PowerShell script to push to the `feature/modify-requests` branch.

To enable automatic local pushes, configure a scheduled task (Windows Task Scheduler) or cron job that runs one of the scripts periodically.
