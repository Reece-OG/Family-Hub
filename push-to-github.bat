@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==========================================
echo   Family Hub - push to GitHub
echo ==========================================
echo.
echo Remote   : https://github.com/Reece-OG/Family-Hub.git
echo Local    : %cd%
echo Branch   : main
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: git is not installed or not on PATH.
  echo Install Git for Windows: https://git-scm.com/download/win
  pause
  exit /b 1
)

REM v4.7.12 — always start with a fresh .git. The snapshot-folder
REM workflow always force-pushes the current tree, so preserving local
REM history is pointless and the on-disk .git accumulates corruption
REM under OneDrive / antivirus / cloud-sync interference (we've hit
REM `improper chunk offset` / `cache entry has null sha1` repeatedly).
REM A clean init each run sidesteps the issue entirely.
if exist ".git" (
  echo [1/5] Removing previous .git folder for a clean push...
  rmdir /s /q ".git"
)
echo [1/5] Initialising local repo on branch main...
git init -b main
if errorlevel 1 (echo Init failed. & pause & exit /b 1)

echo [2/5] Pointing 'origin' at GitHub repo...
git remote remove origin >nul 2>nul
git remote add origin https://github.com/Reece-OG/Family-Hub.git

echo [3/5] Staging all tracked files (respecting .gitignore)...
git add -A

echo [4/5] Committing...
git commit -m "v5.0.7 - Recipes tab: tap a recipe, land on the recipe. User feedback: on phones and tablets, tapping a recipe in the list scrolled the detail below the entire list, so with a decent-sized recipe collection you had to scroll past dozens of titles to see what you just picked - unintuitive and getting worse as the recipe count grew. Root cause: the RecipesView layout is a grid of 3 columns on lg+ (list 1/3, detail 2/3 side-by-side) but collapses to a single column below lg (Tailwind's 1024px breakpoint), which stacks the detail underneath the list. Fix: added a detailRef on the detail column and a useEffect that runs whenever selectedId changes; on viewports below lg it calls scrollIntoView({behavior: smooth, block: start}) inside a requestAnimationFrame so the newly-selected detail is actually rendered before we try to scroll to it. Skips the scroll on lg+ where the detail is already visible beside the list. scroll-mt-4 added to the detail container so the smooth-scrolled position isn't jammed against the top nav. Version, sw CACHE_VERSION and README bumped to 5.0.7. CHANGELOG entry added."
if errorlevel 1 (
  echo No new changes to commit - proceeding to push existing HEAD.
)

echo [5/5] Pushing to origin/main...
git push -u origin main
if %errorlevel% neq 0 (
  echo.
  echo ------------------------------------------
  echo Push was rejected.
  echo This normally means the remote already has
  echo commits that your local copy does not.
  echo ------------------------------------------
  echo.
  set /p FORCE="Overwrite remote main with THIS local tree? (y/N): "
  if /i "!FORCE!"=="y" (
    REM v4.7.11 — plain --force, not --force-with-lease. Each version
    REM lives in its own snapshot folder with a fresh `git init`, so
    REM the local ref database has no record of what's currently on
    REM origin/main and --force-with-lease bails with "stale info".
    REM We're explicitly intentionally replacing main, so plain --force
    REM is the right tool for this workflow.
    git push -u origin main --force
    if errorlevel 1 (
      echo Force push failed. See git output above.
      pause
      exit /b 1
    )
  ) else (
    echo Aborted. Reconcile with 'git pull --rebase origin main' then re-run.
    pause
    exit /b 1
  )
)

echo.
echo ==========================================
echo   Done. View repo:
echo   https://github.com/Reece-OG/Family-Hub
echo ==========================================
pause
