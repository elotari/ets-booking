Param(
  [string]$Branch = 'feature/modify-requests'
)
if (-not (git rev-parse --is-inside-work-tree 2>$null)) { Write-Host 'Not a git repo'; exit 1 }
$status = git status --porcelain
if (-not $status) { Write-Host 'No changes to commit.'; exit 0 }
git add -A
$msg = "Auto update $(Get-Date -Format u)"
try { git commit -m $msg } catch { Write-Host 'Nothing to commit.' }
git push origin $Branch
