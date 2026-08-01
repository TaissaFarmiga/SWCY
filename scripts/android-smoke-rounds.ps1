[CmdletBinding()]
param(
    [ValidateRange(1, 20)]
    [int]$Rounds = 5,
    [ValidateSet('smoke', 'stress', 'screenshots', 'all')]
    [string]$Mode = 'all'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -Raw -Encoding utf8 (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$evidenceRoot = Join-Path $projectRoot "verification\mobile-ux-v$($packageJson.version)\android-final"
$summaryPath = Join-Path $evidenceRoot 'five-rounds-summary.json'
$smokeScript = Join-Path $PSScriptRoot 'android-smoke.ps1'
$junitRoot = Join-Path $projectRoot 'android\app\build\outputs\androidTest-results'
$screenshotRoot = Join-Path $projectRoot '_AI_Tools_\STORE_RELEASE\screenshots'
$previousGradleUserHome = $env:GRADLE_USER_HOME
$env:GRADLE_USER_HOME = Join-Path (Split-Path -Parent $projectRoot) 'gradle-cache-hydro-ux-20260801'

New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$summary = [ordered]@{
    schemaVersion = 1
    appVersion = [string]$packageJson.version
    requestedRounds = $Rounds
    mode = $Mode
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    completedAt = $null
    status = 'running'
    rounds = @()
}

function Write-Summary {
    $summary | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $summaryPath
}

Write-Summary

try {
    for ($round = 1; $round -le $Rounds; $round++) {
        $started = Get-Date
        $roundDir = Join-Path $evidenceRoot ("round-{0:D2}" -f $round)
        New-Item -ItemType Directory -Force -Path $roundDir | Out-Null
        Write-Host "[android-rounds] round $round/$Rounds mode=$Mode"

        if ($round -eq 1) {
            & $smokeScript -Mode $Mode
        } else {
            & $smokeScript -Mode $Mode -SkipWebBuild -SkipSdkInstall
        }

        $junitFiles = @(Get-ChildItem -Path $junitRoot -Filter 'TEST-*.xml' -File -Recurse -ErrorAction Stop)
        if ($junitFiles.Count -eq 0) { throw "Round $round completed without JUnit XML." }
        $copiedReports = @()
        $tests = 0
        $failures = 0
        $errors = 0
        $skipped = 0
        $reportIndex = 0
        foreach ($file in $junitFiles) {
            $reportIndex++
            $destination = Join-Path $roundDir ("junit-{0:D2}.xml" -f $reportIndex)
            Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
            [xml]$xml = Get-Content -Raw -Encoding utf8 $file.FullName
            $suite = $xml.testsuite
            if ($suite) {
                $tests += [int]$suite.tests
                $failures += [int]$suite.failures
                $errors += [int]$suite.errors
                $skipped += [int]$suite.skipped
            }
            $copiedReports += [ordered]@{
                file = (Resolve-Path -Relative $destination)
                sha256 = (Get-FileHash -Algorithm SHA256 $destination).Hash.ToLowerInvariant()
            }
        }

        $screenshots = @()
        if (Test-Path $screenshotRoot) {
            $screenshots = @(Get-ChildItem -Path $screenshotRoot -Filter '*.png' -File | Sort-Object Name | ForEach-Object {
                [ordered]@{ file = $_.Name; sha256 = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLowerInvariant() }
            })
        }

        $roundResult = [ordered]@{
            round = $round
            status = if (($failures + $errors) -eq 0) { 'passed' } else { 'failed' }
            startedAt = $started.ToUniversalTime().ToString('o')
            completedAt = (Get-Date).ToUniversalTime().ToString('o')
            durationSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
            tests = $tests
            failures = $failures
            errors = $errors
            skipped = $skipped
            junit = $copiedReports
            screenshots = $screenshots
        }
        $summary.rounds += $roundResult
        Write-Summary
        if ($roundResult.status -ne 'passed') { throw "Android round $round failed." }
    }

    $summary.status = 'passed'
    $summary.completedAt = (Get-Date).ToUniversalTime().ToString('o')
    $summary.completedRounds = @($summary.rounds | Where-Object status -eq 'passed').Count
    Write-Summary
    Write-Host "[android-rounds] PASS $($summary.completedRounds)/$Rounds"
    Write-Host "[android-rounds] evidence $summaryPath"
} catch {
    $summary.status = 'failed'
    $summary.completedAt = (Get-Date).ToUniversalTime().ToString('o')
    $summary.error = $_.Exception.Message
    Write-Summary
    throw
} finally {
    if ($null -eq $previousGradleUserHome) {
        Remove-Item Env:GRADLE_USER_HOME -ErrorAction SilentlyContinue
    } else {
        $env:GRADLE_USER_HOME = $previousGradleUserHome
    }
}
