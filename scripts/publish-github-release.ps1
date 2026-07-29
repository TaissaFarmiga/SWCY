param(
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$Commit,
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [Parameter(Mandatory = $true)][long]$ApkSize,
    [Parameter(Mandatory = $true)][string]$Digest,
    [Parameter(Mandatory = $true)][string]$ReleaseNameBase64,
    [Parameter(Mandatory = $true)][string]$ReleaseNotesBase64
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$token = $env:GITHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'PowerShell publisher requires GITHUB_TOKEN'
}
if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
    throw "APK file does not exist: $ApkPath"
}
if ((Get-Item -LiteralPath $ApkPath).Length -ne $ApkSize) {
    throw 'APK size changed before publishing'
}

$releaseName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ReleaseNameBase64))
$releaseNotes = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ReleaseNotesBase64))

$apiBase = "https://api.github.com/repos/$Repository"
$headers = @{
    Accept = 'application/vnd.github+json'
    Authorization = "Bearer $token"
    'User-Agent' = 'HydroTerminal-Release'
    'X-GitHub-Api-Version' = '2022-11-28'
}
$draftId = $null

function Invoke-GitHubJson {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [object]$Body
    )

    $parameters = @{
        Method = $Method
        Uri = $Uri
        Headers = $headers
    }
    if ($null -ne $Body) {
        $parameters.Body = $Body | ConvertTo-Json -Depth 8 -Compress
        $parameters.ContentType = 'application/json; charset=utf-8'
    }
    return Invoke-RestMethod @parameters
}

try {
    $draft = Invoke-GitHubJson -Method 'Post' -Uri "$apiBase/releases" -Body @{
        tag_name = $Tag
        target_commitish = $Commit
        name = $releaseName
        body = $releaseNotes
        draft = $true
        prerelease = $false
        generate_release_notes = $true
    }
    $draftId = $draft.id

    $uploadUrl = $draft.upload_url.Split('{')[0] + '?name=update.apk'
    $null = Invoke-RestMethod -Method 'Post' -Uri $uploadUrl -Headers $headers -InFile $ApkPath -ContentType 'application/vnd.android.package-archive'

    $draftCheck = Invoke-GitHubJson -Method 'Get' -Uri "$apiBase/releases/$draftId"
    $draftAsset = @($draftCheck.assets | Where-Object { $_.name -eq 'update.apk' -and $_.state -eq 'uploaded' }) | Select-Object -First 1
    if ($null -eq $draftAsset -or $draftAsset.size -ne $ApkSize -or $draftAsset.digest -ne "sha256:$Digest") {
        throw 'GitHub draft validation failed: APK size or SHA-256 mismatch'
    }

    $null = Invoke-GitHubJson -Method 'Patch' -Uri "$apiBase/releases/$draftId" -Body @{ draft = $false }
    $published = Invoke-GitHubJson -Method 'Get' -Uri "$apiBase/releases/tags/$Tag"
    $publishedAsset = @($published.assets | Where-Object { $_.name -eq 'update.apk' -and $_.state -eq 'uploaded' }) | Select-Object -First 1
    if ($published.draft -or $null -eq $publishedAsset -or $publishedAsset.size -ne $ApkSize -or $publishedAsset.digest -ne "sha256:$Digest") {
        throw 'Published GitHub Release validation failed'
    }

    [pscustomobject]@{
        version = $Tag.TrimStart('v')
        tag = $Tag
        commit = $Commit
        releaseUrl = $published.html_url
        apkSize = $publishedAsset.size
        sha256 = $Digest
    } | ConvertTo-Json -Compress
} catch {
    if ($null -ne $draftId) {
        try {
            $null = Invoke-GitHubJson -Method 'Delete' -Uri "$apiBase/releases/$draftId"
        } catch {
            # Best-effort cleanup; preserve the original exception.
        }
    }
    throw
}
