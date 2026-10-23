#Requires -Version 5.1
<#
  Explainer Studio release (Windows only). Based on Igent's release script.

  One PUBLIC repo ($REPO, this clone's `origin`) holds both the source and the
  downloads on its Releases page.

  Nothing is pushed or published until the build has passed.

    1. Preflight     - on main, gh logged in, origin is $REPO, not behind origin,
                       version and tag not used yet (here, on origin, on Releases).
    2. Notes         - release-notes.json: keeps an entry you already wrote for
                       this version, or asks AI to draft one from the commits.
    3. Bump + build  - package.json version, then type-check, tests and the
                       Setup + portable zip. A failure puts both files back.
    4. Commit + tag  - LOCAL only so far.
    5. Push          - main and the tag to origin. The release needs the tag on
                       GitHub first, because source and downloads share one repo.
                       A failure undoes the local tag and commit.
    6. Publish       - a DRAFT release, files uploaded, then published. A failure
                       deletes the draft and prints the command to try again.

  Files uploaded: ExplainerStudio-Setup-X.exe, ExplainerStudio-X-portable.zip
  and SHA256SUMS.txt. There is no auto-updater, so no latest.yml or .blockmap.
#>

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot/ai-chat.ps1"

$REPO        = 'sarfraznawaz2005/explainer-studio'
$BRANCH      = 'main'
$NAME        = 'Explainer Studio'
$PLACEHOLDER = 'Describe what changed for users here'

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }
function Step($label) { Write-Host ""; Write-Host "-> $label" -ForegroundColor Cyan }
function Write-Utf8($path, $text) { [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false)) }
# Opens a file in the first editor found. Full paths on purpose: Git for Windows puts a
# 'notepad' shell script on PATH, and Windows 11 Notepad is a Store app outside System32.
function Open-Editor([string]$path) {
    $candidates = @(
        (Get-Command code.cmd -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
        (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\bin\code.cmd"),
        (Join-Path $env:ProgramFiles "Microsoft VS Code\bin\code.cmd"),
        (Get-Command notepad++.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
        (Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\notepad.exe"),
        (Join-Path $env:WINDIR "System32\notepad.exe"),
        (Join-Path $env:WINDIR "notepad.exe")
    ) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($exe in $candidates) {
        try {
            Start-Process -FilePath $exe -ArgumentList "`"$path`"" -ErrorAction Stop
            Write-Host "  Opened in $(Split-Path $exe -Leaf)." -ForegroundColor DarkGray
            return
        }
        catch { }
    }
    Write-Host "  No editor could be opened. Edit this file yourself: $path" -ForegroundColor Yellow
}
# Windows PowerShell 5 returns a JSON array as ONE object; ForEach-Object unrolls it so both versions give the items.
function Read-JsonArray([string]$json) { $json | ConvertFrom-Json | ForEach-Object { $_ } }

Write-Host ""
Write-Host "=== $NAME Release ===" -ForegroundColor Cyan

# ============================================================================
# 1. Preflight
# ============================================================================

git rev-parse --git-dir 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Not inside a git repository. Run push.bat once first (it tells you how to set up the repo)." }
if (git status --porcelain | Select-String "^UU") { Fail "Merge conflicts found. Fix them first." }

$branch = git symbolic-ref --short HEAD 2>$null
if ($branch -ne $BRANCH) { Fail "You are on '$branch'. Releases are made from '$BRANCH'." }
git rev-parse --verify HEAD 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "This repository has no commits yet. Run push.bat first." }

$origin = git remote get-url origin 2>$null
if (-not $origin) { Fail "No 'origin' remote. Add it: git remote add origin https://github.com/$REPO.git" }
if ($origin -notmatch [regex]::Escape($REPO)) { Fail "origin is '$origin', but releases go to $REPO. Fix `$REPO in scripts/release.ps1 or the remote." }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "The GitHub CLI (gh) is needed. Install it from https://cli.github.com and run: gh auth login" }
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "gh is not logged in. Run: gh auth login" }
gh repo view $REPO --json name 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "gh cannot see $REPO. Create the repo on GitHub, or check the name and your access." }

Write-Host "Fetching remote state..." -ForegroundColor DarkGray
git fetch --tags --prune --quiet
if ($LASTEXITCODE -ne 0) { Fail "git fetch failed. Check your connection." }
git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" 2>&1 | Out-Null
$remoteHasBranch = $LASTEXITCODE -eq 0
if ($remoteHasBranch) {
    $behind = [int](git rev-list --count "HEAD..origin/$BRANCH" 2>$null)
    if ($behind -gt 0) { Fail "Your $BRANCH is $behind commit(s) behind origin. Run 'git pull' first." }
}

$hasUncommitted = [bool](git status --porcelain)
if ($hasUncommitted) {
    Write-Host ""
    Write-Host "You have uncommitted changes:" -ForegroundColor Yellow
    git status --short
    $inc = Read-Host "Include them in the release commit? (y/N)"
    if ($inc -notmatch '^[Yy]$') { Fail "Stopped. Commit or stash your changes first (push.bat does this)." }
}

$pkgRaw = Get-Content "package.json" -Raw
$current = ($pkgRaw | ConvertFrom-Json).version
Write-Host ""
Write-Host "Current version: " -NoNewline
Write-Host "v$current" -ForegroundColor Yellow

$version = (Read-Host "Enter the new version (e.g. 1.0.1)").Trim().TrimStart('v')
if ($version -notmatch '^\d+\.\d+\.\d+$') { Fail "'$version' is not MAJOR.MINOR.PATCH (e.g. 1.0.1)." }
if ([version]$version -lt [version]$current) { Fail "v$version is lower than the current v$current." }
$tag = "v$version"

if (git tag --list $tag) { Fail "Tag $tag already exists here. Delete it (git tag -d $tag) if it is left over from a failed attempt." }
git ls-remote --exit-code --tags origin "refs/tags/$tag" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Fail "Tag $tag already exists on origin." }

$releasesRaw = gh api "repos/$REPO/releases?per_page=100" 2>&1
if ($LASTEXITCODE -ne 0) { Fail "Could not read the releases of $REPO - $releasesRaw" }
$existing = @(Read-JsonArray ($releasesRaw -join "`n") | Where-Object { $_.tag_name -eq $tag })
if ($existing | Where-Object { -not $_.draft }) { Fail "$tag is already published on $REPO." }
if ($existing) {
    Write-Host "A leftover draft for $tag exists on $REPO - deleting it." -ForegroundColor Yellow
    gh release delete $tag --repo $REPO --yes 2>&1 | Out-Null
}

# ============================================================================
# 2. Release notes
# ============================================================================

$notesPath = Join-Path $Root "release-notes.json"
$notesBefore = if (Test-Path $notesPath) { Get-Content $notesPath -Raw } else { "[]" }
$all = @(Read-JsonArray $notesBefore)
$entry = $all | Where-Object { $_.version -eq $version } | Select-Object -First 1

if ($entry) {
    Write-Host ""
    Write-Host "release-notes.json already has v${version}:" -ForegroundColor Green
    Write-Host "  $($entry.title)"
    foreach ($c in $entry.changes) { Write-Host "    * $c" -ForegroundColor DarkGray }
    $keep = Read-Host "Use these notes? (Y/n)"
    if ($keep -match '^[Nn]$') { $entry = $null }
}

if (-not $entry) {
    Step "Writing release notes"
    $lastTag = git describe --tags --abbrev=0 2>$null
    $range = if ($lastTag) { "$lastTag..HEAD" } else { "HEAD" }
    $devOnly = '^(chore|ci|build|test|refactor|style|revert|docs)(\([^)]*\))?!?:'
    $commits = @(git log $range --pretty=format:"%s" 2>$null | Where-Object { $_ -and $_ -notmatch $devOnly })
    $draft = $null

    if ($commits.Count -eq 0) {
        Write-Host "  No user-facing commits since $(if ($lastTag) { $lastTag } else { 'the start' })." -ForegroundColor Yellow
    }
    elseif (-not (Get-AiProviderNames)) {
        Write-Host "  No AI provider found, so you write the notes yourself." -ForegroundColor Yellow
        Write-AiProviderHelp
    }
    else {
        $system = @"
You write release notes for Explainer Studio, a Windows desktop app that turns learning material (PDFs, documents, pasted text) into long-form YouTube explainer videos with AI-written scripts, narration, motion graphics, music and captions. Its users are teachers and YouTube creators, not programmers. They read these notes on the GitHub Releases page.

Every bullet must describe something a user can SEE, CLICK or NOTICE in the app or in the videos it makes. Drop anything only developers care about: database, migrations, IPC, types, dependencies, build scripts, tests, docs, logging, refactors.

RULES:
1. Group related commits into one bullet.
2. Plain, simple English. Short sentences. Say what the user can do now or what works better.
3. Never name code identifiers, files, packages, commit hashes or branches.
4. No filler such as "improved performance" without something a user would notice.
5. At most 8 bullets.
6. A short title (3-7 words) for the whole release.
7. If nothing is user-facing, return {"title":null,"changes":[]}

Return ONLY valid JSON, no markdown: {"title":"...","changes":["...","..."]}
"@
        $validate = {
            param($raw)
            $t = "$raw".Trim() -replace '^```(?:json)?\s*', '' -replace '\s*```$', ''
            $s = $t.IndexOf('{'); $e = $t.LastIndexOf('}')
            if ($s -lt 0 -or $e -le $s) { return $null }
            try { return ($t.Substring($s, $e - $s + 1) | ConvertFrom-Json) } catch { return $null }
        }
        $parsed = Invoke-AiChat -System $system -User "Commits:`n$($commits -join "`n")" -MaxTokens 700 -JsonMode -Validate $validate
        if ($parsed -and $parsed.title -and $parsed.changes.Count -gt 0) { $draft = $parsed }
        else { Write-Host "  AI gave no usable notes." -ForegroundColor Yellow }
    }

    if (-not $draft) { $draft = [PSCustomObject]@{ title = "$NAME $version"; changes = @($PLACEHOLDER) } }
    $entry = [PSCustomObject]@{ version = $version; title = $draft.title; changes = @($draft.changes) }
    $others = @($all | Where-Object { $_.version -ne $version })
    Write-Utf8 $notesPath (ConvertTo-Json -InputObject (@($entry) + $others) -Depth 5)

    Write-Host ""
    Write-Host "  Draft notes for v${version}:" -ForegroundColor Green
    Write-Host "  $($entry.title)"
    foreach ($c in $entry.changes) { Write-Host "    * $c" -ForegroundColor DarkGray }
    # The placeholder must be replaced, so the editor opens without asking.
    $mustEdit = @($entry.changes) -contains $PLACEHOLDER
    $edit = if ($mustEdit) { 'y' } else { Read-Host "  Open release-notes.json to edit them first? (y/N)" }
    if ($edit -match '^[Yy]$') {
        if ($mustEdit) { Write-Host "  Write the notes for v$version in release-notes.json (replace the placeholder line)." -ForegroundColor Yellow }
        Open-Editor $notesPath
        Read-Host "  Edit and save, then press Enter to continue" | Out-Null
    }
    $entry = @(Read-JsonArray (Get-Content $notesPath -Raw)) | Where-Object { $_.version -eq $version } | Select-Object -First 1
    if (-not $entry -or -not $entry.title -or @($entry.changes).Count -eq 0 -or @($entry.changes) -contains $PLACEHOLDER) {
        Write-Utf8 $notesPath $notesBefore
        Fail "release-notes.json has no real notes for v$version (missing, empty or still the placeholder). Nothing was changed."
    }
}

# ============================================================================
# 3. Bump + build
# ============================================================================

function Restore-Files {
    Write-Utf8 (Join-Path $Root "package.json") $pkgRaw
    Write-Utf8 $notesPath $notesBefore
    Write-Host "package.json and release-notes.json were put back." -ForegroundColor Yellow
}

$pkgNew = $pkgRaw -replace '("version":\s*")\d+\.\d+\.\d+', ('${1}' + $version)
Write-Utf8 (Join-Path $Root "package.json") $pkgNew

$setup    = "release\ExplainerStudio-Setup-$version.exe"
$portable = "release\ExplainerStudio-$version-portable.zip"
$sums     = "release\SHA256SUMS.txt"
# Old outputs only; release\ is build output and is git-ignored.
Remove-Item "release\ExplainerStudio-Setup-*.exe", "release\ExplainerStudio-*-portable.zip", $sums -ErrorAction SilentlyContinue

# dist runs the type-check first, then builds the app, the video bundle and both files.
foreach ($s in @(
    @{ Label = "Tests"; Cmd = { npm test } },
    @{ Label = "Type-check and build Setup + portable zip"; Cmd = { npm run dist } }
)) {
    Step $s.Label
    & $s.Cmd
    if ($LASTEXITCODE -ne 0) { Restore-Files; Fail "RELEASE STOPPED: $($s.Label) failed. Nothing was committed, pushed or published." }
}

foreach ($f in @($setup, $portable)) {
    if (-not (Test-Path $f)) { Restore-Files; Fail "RELEASE STOPPED: the build did not make $f." }
}
$lines = foreach ($f in @($setup, $portable)) {
    "$((Get-FileHash $f -Algorithm SHA256).Hash.ToLower())  $(Split-Path $f -Leaf)"
}
Write-Utf8 (Join-Path $Root $sums) (($lines -join "`n") + "`n")
Write-Host "  Built $setup and $portable" -ForegroundColor Green

# ============================================================================
# 4. Commit + tag (local)
# ============================================================================

Step "Committing v$version (local)"
git add package.json release-notes.json
if ($hasUncommitted) { git add -A }
# Never let a secrets file ride along by accident.
$risky = @(git diff --cached --name-only | Where-Object { $_ -match '(^|/)(\.env(\..*)?|[^/]*\.(pem|key|p12|pfx))$' })
if ($risky.Count -gt 0) {
    git reset --quiet
    Restore-Files
    Fail "These files look like secrets and were about to be committed: $($risky -join ', '). Nothing was committed."
}
$madeCommit = $false
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "chore: release $tag"
    if ($LASTEXITCODE -ne 0) { Restore-Files; Fail "git commit failed." }
    $madeCommit = $true
}
else {
    Write-Host "  Nothing new to commit: the version and notes are already committed. Tagging the current commit." -ForegroundColor DarkGray
}
git tag -a $tag -m "$NAME $tag"
if ($LASTEXITCODE -ne 0) {
    if ($madeCommit) { git reset --soft HEAD~1 }
    Restore-Files
    Fail "git tag failed.$(if ($madeCommit) { ' The commit was undone.' })"
}

function Undo-Local {
    git tag -d $tag 2>&1 | Out-Null
    if ($madeCommit) {
        git reset --soft HEAD~1
        Write-Host "The local tag and commit were undone. Your file changes are kept." -ForegroundColor Yellow
    }
    else {
        Write-Host "The local tag was removed." -ForegroundColor Yellow
    }
}

# ============================================================================
# 5. Push main and the tag
# ============================================================================

Step "Pushing $BRANCH and $tag to origin"
if ($remoteHasBranch) { git push origin $BRANCH } else { git push -u origin $BRANCH }
if ($LASTEXITCODE -ne 0) { Undo-Local; Fail "RELEASE STOPPED: pushing $BRANCH failed. Nothing was published." }
git push origin $tag
if ($LASTEXITCODE -ne 0) {
    Write-Host "$BRANCH was pushed, but the tag was not. Do not run release.bat again. Run these two commands:" -ForegroundColor Yellow
    Write-Host "  git push origin $tag"
    Write-Host "  gh release create $tag `"$setup`" `"$portable`" `"$sums`" --repo $REPO --title `"$NAME $tag`" --generate-notes --verify-tag --latest"
    exit 1
}

# ============================================================================
# 6. Publish the release
# ============================================================================

Step "Publishing $tag on $REPO"
$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("## $($entry.title)")
[void]$md.AppendLine("")
foreach ($c in $entry.changes) { [void]$md.AppendLine("- $c") }
[void]$md.AppendLine("")
[void]$md.AppendLine("### Downloads (Windows 10/11, 64-bit)")
[void]$md.AppendLine("- **ExplainerStudio-Setup-$version.exe**: installer (recommended).")
[void]$md.AppendLine("- **ExplainerStudio-$version-portable.zip**: portable. Unzip to a folder and run 'Explainer Studio.exe'.")
[void]$md.AppendLine("")
[void]$md.AppendLine("The installer is not code-signed yet. If Windows SmartScreen warns, choose **More info > Run anyway**.")
[void]$md.AppendLine("Your data is kept in %APPDATA%\Explainer Studio. SHA-256 checksums are in SHA256SUMS.txt.")
$notesFile = Join-Path $env:TEMP "explainer-studio-release-$version.md"
Write-Utf8 $notesFile $md.ToString()

$retry = "gh release create $tag `"$setup`" `"$portable`" `"$sums`" --repo $REPO --title `"$NAME $tag`" --notes-file `"$notesFile`" --verify-tag --latest"
gh release create $tag $setup $portable $sums --repo $REPO --title "$NAME $tag" --notes-file $notesFile --verify-tag --draft
if ($LASTEXITCODE -ne 0) {
    gh release delete $tag --repo $REPO --yes 2>&1 | Out-Null
    Write-Host "The code and tag are on GitHub, but making the release failed. Try again with:" -ForegroundColor Yellow
    Write-Host "  $retry"
    exit 1
}
gh release edit $tag --repo $REPO --draft=false --latest
if ($LASTEXITCODE -ne 0) {
    gh release delete $tag --repo $REPO --yes 2>&1 | Out-Null
    Write-Host "Publishing the release failed. The draft was deleted. Try again with:" -ForegroundColor Yellow
    Write-Host "  $retry"
    exit 1
}
Remove-Item $notesFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== $NAME $tag released ===" -ForegroundColor Green
Write-Host "https://github.com/$REPO/releases/tag/$tag"
