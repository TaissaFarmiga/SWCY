[CmdletBinding()]
param(
    [switch]$SkipWebBuild,
    [switch]$SkipSdkInstall,
    [ValidateSet('smoke', 'stress', 'screenshots', 'all')]
    [string]$Mode = 'smoke'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'android'

function Invoke-Checked {
    param([string]$Label, [scriptblock]$Action)
    Write-Host "[android-smoke] $Label"
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Resolve-AndroidSdk {
    $candidates = @(@(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        'D:\Android\SDK',
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { $_ -and (Test-Path $_) })
    if ($candidates.Count -eq 0) {
        throw 'Android SDK not found. Set ANDROID_SDK_ROOT.'
    }
    return [System.IO.Path]::GetFullPath($candidates[0])
}

function Get-EmulatorSerials {
    param([string]$Adb)
    $lines = & $Adb devices
    return @($lines | Select-String '^emulator-\d+\s+\S+$' | ForEach-Object { ($_ -split '\s+')[0] })
}

function Invoke-AdbText {
    param([string]$Adb, [string[]]$CommandArguments)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $output = & $Adb @CommandArguments 2>$null
        if ($LASTEXITCODE -ne 0) { return '' }
        return ($output | Out-String).Trim()
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

$androidSdk = Resolve-AndroidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_AVD_HOME = Join-Path $androidSdk '.managed-avd'
New-Item -ItemType Directory -Force -Path $env:ANDROID_AVD_HOME | Out-Null
$adb = Join-Path $androidSdk 'platform-tools\adb.exe'
$sdkManager = Join-Path $androidSdk 'cmdline-tools\latest\bin\sdkmanager.bat'
$avdManager = Join-Path $androidSdk 'cmdline-tools\latest\bin\avdmanager.bat'
$emulator = Join-Path $androidSdk 'emulator\emulator.exe'
$imagePackageXml = Join-Path $androidSdk 'system-images\android-35\aosp_atd\x86_64\package.xml'
$reportRoot = Join-Path $androidRoot 'app\build\reports\android-smoke'
$avdName = "hydro_${Mode}_api35_$PID"
$emulatorStdout = Join-Path $reportRoot 'emulator.stdout.log'
$emulatorStderr = Join-Path $reportRoot 'emulator.stderr.log'
$emulatorProcess = $null
$emulatorSerial = $null
$previousAndroidSerial = $env:ANDROID_SERIAL

if (-not (Test-Path $adb)) { throw "ADB not found: $adb" }
if (-not (Test-Path $sdkManager)) { throw "sdkmanager not found: $sdkManager" }
if (-not (Test-Path $avdManager)) { throw "avdmanager not found: $avdManager" }
if (-not (Test-Path $emulator)) { throw "emulator not found: $emulator" }

$emulatorsBefore = Get-EmulatorSerials -Adb $adb

try {
    if (-not $SkipSdkInstall -and -not (Test-Path $imagePackageXml)) {
        Invoke-Checked 'Install API 35 aosp-atd x86_64 system image' {
            & $sdkManager 'platforms;android-35' 'system-images;android-35;aosp_atd;x86_64'
        }
    }
    if (-not (Test-Path $imagePackageXml)) {
        throw "API 35 aosp-atd system image is incomplete: $imagePackageXml"
    }

    Push-Location $projectRoot
    try {
        if (-not $SkipWebBuild) {
            Invoke-Checked 'Build production web assets' { & npm.cmd run build }
            Invoke-Checked 'Sync Capacitor Android' { & npx.cmd cap sync android }
        }
    } finally {
        Pop-Location
    }

    New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null
    Invoke-Checked 'Create disposable API 35 AVD' {
        'no' | & $avdManager create avd --force --name $avdName --package 'system-images;android-35;aosp_atd;x86_64' --device 'pixel_2'
    }

    Write-Host "[android-smoke] Start disposable AVD $avdName"
    $emulatorProcess = Start-Process -FilePath $emulator -ArgumentList @(
        "@$avdName", '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot',
        '-wipe-data', '-gpu', 'swiftshader_indirect'
    ) -WindowStyle Hidden -RedirectStandardOutput $emulatorStdout -RedirectStandardError $emulatorStderr -PassThru

    $serialDeadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $serialDeadline -and -not $emulatorSerial) {
        if ($emulatorProcess.HasExited) {
            $tail = if (Test-Path $emulatorStderr) { (Get-Content $emulatorStderr | Select-Object -Last 40) -join [Environment]::NewLine } else { '' }
            throw "Emulator exited before ADB registration. $tail"
        }
        $emulatorSerial = @(Get-EmulatorSerials -Adb $adb | Where-Object { $_ -notin $emulatorsBefore }) | Select-Object -First 1
        if (-not $emulatorSerial) { Start-Sleep -Seconds 2 }
    }
    if (-not $emulatorSerial) { throw 'Timed out waiting for emulator ADB registration.' }

    Write-Host "[android-smoke] Wait for Android boot on $emulatorSerial"
    $bootDeadline = (Get-Date).AddMinutes(4)
    $bootCompleted = $false
    while ((Get-Date) -lt $bootDeadline -and -not $bootCompleted) {
        if ($emulatorProcess.HasExited) { throw 'Emulator exited before Android completed boot.' }
        $state = Invoke-AdbText -Adb $adb -CommandArguments @('-s', $emulatorSerial, 'get-state')
        $boot = if ($state -eq 'device') { Invoke-AdbText -Adb $adb -CommandArguments @('-s', $emulatorSerial, 'shell', 'getprop', 'sys.boot_completed') } else { '' }
        $bootCompleted = $state -eq 'device' -and $boot -eq '1'
        if (-not $bootCompleted) { Start-Sleep -Seconds 2 }
    }
    if (-not $bootCompleted) { throw "Timed out waiting for Android boot on $emulatorSerial." }

    $env:ANDROID_SERIAL = $emulatorSerial
    $testClass = if ($Mode -eq 'stress') {
        'com.hydro.geekterminal.HydroStressInstrumentedTest'
    } elseif ($Mode -eq 'screenshots') {
        'com.hydro.geekterminal.StoreScreenshotInstrumentedTest'
    } elseif ($Mode -eq 'all') {
        'com.hydro.geekterminal.ColdStartInstrumentedTest,com.hydro.geekterminal.HydroSmokeInstrumentedTest,com.hydro.geekterminal.StoreScreenshotInstrumentedTest,com.hydro.geekterminal.HydroStressInstrumentedTest'
    } else {
        'com.hydro.geekterminal.ColdStartInstrumentedTest,com.hydro.geekterminal.HydroSmokeInstrumentedTest,com.hydro.geekterminal.StoreScreenshotInstrumentedTest'
    }
    $testStartedAt = (Get-Date).AddSeconds(-5)
    Push-Location $androidRoot
    try {
        Invoke-Checked "Run connected SmokeDebug instrumentation tests ($Mode)" {
            & .\gradlew.bat connectedSmokeDebugAndroidTest --max-workers=1 --no-daemon --no-watch-fs --console=plain "-Pandroid.testInstrumentationRunnerArguments.class=$testClass"
        }
    } finally {
        Pop-Location
    }

    $junitFiles = @(Get-ChildItem -Path (Join-Path $androidRoot 'app\build\outputs\androidTest-results') -Filter 'TEST-*.xml' -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $testStartedAt })
    $htmlFiles = @(Get-ChildItem -Path (Join-Path $androidRoot 'app\build\reports\androidTests') -Filter 'index.html' -File -Recurse -ErrorAction SilentlyContinue)
    if ($junitFiles.Count -eq 0) { throw 'Test task completed but no JUnit XML report was found.' }

    if ($Mode -ne 'stress') {
        $deviceScreenshots = '/sdcard/Pictures/HydroStore'
        $storeScreenshots = Join-Path $projectRoot '_AI_Tools_\STORE_RELEASE\screenshots'
        New-Item -ItemType Directory -Force -Path $storeScreenshots | Out-Null
        Invoke-Checked 'Pull real store screenshots from emulator' {
            & $adb -s $emulatorSerial pull "$deviceScreenshots/." $storeScreenshots
        }
    }

    Write-Host "[android-smoke] PASS mode=$Mode"
    $junitFiles | ForEach-Object { Write-Host "JUnit: $($_.FullName)" }
    $htmlFiles | ForEach-Object { Write-Host "HTML:  $($_.FullName)" }
} finally {
    if ($previousAndroidSerial) { $env:ANDROID_SERIAL = $previousAndroidSerial } else { Remove-Item Env:ANDROID_SERIAL -ErrorAction SilentlyContinue }
    if ($emulatorSerial) {
        Write-Host "[android-smoke] Stop disposable emulator $emulatorSerial"
        & $adb -s $emulatorSerial emu kill | Out-Null
    }
    if ($emulatorProcess -and -not $emulatorProcess.HasExited) {
        $emulatorProcess.WaitForExit(10000) | Out-Null
        if (-not $emulatorProcess.HasExited) { Stop-Process -Id $emulatorProcess.Id -Force }
    }
    & $avdManager delete avd --name $avdName 2>$null | Out-Null
    $emulatorsAfter = Get-EmulatorSerials -Adb $adb
    $newEmulators = @($emulatorsAfter | Where-Object { $_ -notin $emulatorsBefore })
    foreach ($serial in $newEmulators) {
        Write-Host "[android-smoke] Stop leftover test emulator $serial"
        & $adb -s $serial emu kill | Out-Null
    }
}
