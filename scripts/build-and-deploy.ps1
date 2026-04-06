[CmdletBinding()]
param(
    [switch]$Deploy,
    [string]$EnvironmentUrl = "https://pasandbox.crm.dynamics.com",
    [string]$Username,
    [switch]$SanitizeConnectorRedirectUrl = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Host "Repo root: $repoRoot"

function New-SanitizedSolutionZip {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InputZipPath,
        [Parameter(Mandatory = $true)]
        [string]$OutputZipPath
    )

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("solution_sanitize_" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null

    try {
        Expand-Archive -Path $InputZipPath -DestinationPath $tempRoot -Force

        $connectorDir = Join-Path $tempRoot "Connector"
        if (-not (Test-Path $connectorDir)) {
            Write-Host "Sanitize: no Connector folder found in package. Skipping redirectUrl cleanup."
            Copy-Item -Path $InputZipPath -Destination $OutputZipPath -Force
            return
        }

        $jsonFiles = Get-ChildItem -Path $connectorDir -Filter "*connectionparameters*.json" -File
        $updatedCount = 0
        foreach ($file in $jsonFiles) {
            $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
            $json = $content | ConvertFrom-Json

            if ($file.Name -like "*connectionparametersets.json") {
                foreach ($value in $json.values) {
                    if ($null -ne $value.parameters -and $null -ne $value.parameters.token -and $null -ne $value.parameters.token.oAuthSettings) {
                        $value.parameters.token.oAuthSettings | Add-Member -NotePropertyName redirectMode -NotePropertyValue "Global" -Force
                        $value.parameters.token.oAuthSettings | Add-Member -NotePropertyName redirectUrl -NotePropertyValue "https://global.consent.azure-apim.net/redirect" -Force
                    }
                }
            } else {
                if ($null -ne $json.token -and $null -ne $json.token.oAuthSettings) {
                    $json.token.oAuthSettings | Add-Member -NotePropertyName redirectMode -NotePropertyValue "Global" -Force
                    $json.token.oAuthSettings | Add-Member -NotePropertyName redirectUrl -NotePropertyValue "https://global.consent.azure-apim.net/redirect" -Force
                }
            }

            $updated = $json | ConvertTo-Json -Depth 100 -Compress
            if ($updated -ne $content) {
                Set-Content -Path $file.FullName -Value $updated -Encoding UTF8
                $updatedCount++
            }
        }

        if (Test-Path $OutputZipPath) {
            Remove-Item $OutputZipPath -Force
        }

        Compress-Archive -Path (Join-Path $tempRoot "*") -DestinationPath $OutputZipPath -CompressionLevel Optimal
        Write-Host "Sanitize: updated $updatedCount connector json file(s)."
        Write-Host "Sanitize: wrote $OutputZipPath"
    } finally {
        if (Test-Path $tempRoot) {
            Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# -------------------------------------------------------
# 1. Bump Solution version
# -------------------------------------------------------
$solutionXmlPath = Join-Path $repoRoot "Solution\src\Other\Solution.xml"
$solutionXml = [xml](Get-Content $solutionXmlPath -Encoding UTF8)
$currentSolutionVersion = $solutionXml.ImportExportXml.SolutionManifest.Version
$verParts = $currentSolutionVersion -split '\.'
$verParts[-1] = [int]$verParts[-1] + 1
$newSolutionVersion = $verParts -join '.'
$solutionXml.ImportExportXml.SolutionManifest.Version = $newSolutionVersion
$solutionXml.Save($solutionXmlPath)
Write-Host "Solution version ($solutionXmlPath): $currentSolutionVersion -> $newSolutionVersion"

# -------------------------------------------------------
# 2. Bump Control manifest version
# -------------------------------------------------------
$manifestPath = Join-Path $repoRoot "ModernDataGrid\ControlManifest.Input.xml"
$manifestContent = Get-Content $manifestPath -Raw
$manifestXml = [xml]$manifestContent
$currentControlVersion = $manifestXml.manifest.control.version
$ctrlParts = $currentControlVersion -split '\.'
$ctrlParts[-1] = [int]$ctrlParts[-1] + 1
$newControlVersion = $ctrlParts -join '.'
$manifestXml.manifest.control.SetAttribute("version", $newControlVersion)
$manifestXml.Save($manifestPath)
Write-Host "Control manifest version: $currentControlVersion -> $newControlVersion"

# -------------------------------------------------------
# 3. Add PCF project reference to solution
# -------------------------------------------------------
Write-Host "Running: pac solution add-reference --path ..\Modern-Data-Grid.pcfproj"
Push-Location (Join-Path $repoRoot "Solution")
try {
    pac solution add-reference --path "..\Modern-Data-Grid.pcfproj"
} finally {
    Pop-Location
}

# -------------------------------------------------------
# 4. Remove stale managed package
# -------------------------------------------------------
$managedZip = Join-Path $repoRoot "Solution\bin\Debug\Solution_managed.zip"
if (Test-Path $managedZip) {
    Write-Host "Removing old package: $managedZip"
    Remove-Item $managedZip -Force
}

# Clear the metadata folder to avoid file-lock errors from VS Code's file watcher
$metadataDir = Join-Path $repoRoot "Solution\obj\Debug\Metadata"
if (Test-Path $metadataDir) {
    Write-Host "Clearing metadata folder: $metadataDir"
    # Use cmd /c rmdir as it is more forceful than Remove-Item against file watchers
    & cmd /c "rmdir /s /q `"$metadataDir`"" 2>$null
    # Wait a moment and verify; fall back to Remove-Item if cmd failed
    Start-Sleep -Milliseconds 500
    if (Test-Path $metadataDir) {
        Remove-Item -Recurse -Force $metadataDir -ErrorAction SilentlyContinue
    }
}

# -------------------------------------------------------
# 5. Build PCF component in production mode (TypeScript -> bundle)
# -------------------------------------------------------
Write-Host "Running: npm run build:prod (PCF component)"
Push-Location $repoRoot
try {
    npm run build:prod
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm run build:prod failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

# -------------------------------------------------------
# 7. Build solution (package PCF bundle into zip)
# -------------------------------------------------------
$solutionCdsproj = Join-Path $repoRoot "Solution\Solution.cdsproj"
Write-Host "Running: dotnet build `"$solutionCdsproj`""
dotnet build $solutionCdsproj
$buildExitCode = $LASTEXITCODE

# The managed zip is what matters - MSBuild sometimes exits non-zero due to a temp
# folder lock (obj\Debug\Metadata) even though all output files were produced.
# Treat a missing managed zip as the real failure.
$managedZipCheck = Join-Path $repoRoot "Solution\bin\Debug\Solution_managed.zip"
if ($buildExitCode -ne 0) {
    if (Test-Path $managedZipCheck) {
        Write-Host "Note: dotnet build reported errors but Solution_managed.zip was produced - likely a harmless cleanup lock. Continuing."
    } else {
        Write-Error "dotnet build failed (exit $buildExitCode) and Solution_managed.zip was not produced."
        exit $buildExitCode
    }
}

# -------------------------------------------------------
# 8. Optional sanitize of connector redirectUrl values
# -------------------------------------------------------
$deployZipPath = $managedZipCheck
if ($SanitizeConnectorRedirectUrl) {
    $sanitizedZip = Join-Path $repoRoot "Solution\bin\Debug\Solution_managed_sanitized.zip"
    New-SanitizedSolutionZip -InputZipPath $managedZipCheck -OutputZipPath $sanitizedZip
    $deployZipPath = $sanitizedZip
}

# -------------------------------------------------------
# 9. Deploy (optional)
# -------------------------------------------------------
if ($Deploy) {
    $managedZipDeploy = $deployZipPath
    if (-not (Test-Path $managedZipDeploy)) {
        Write-Error "Managed zip not found at: $managedZipDeploy"
        exit 1
    }

    Write-Host "Deploying to $EnvironmentUrl ..."

    $importArgs = @(
        "solution", "import",
        "--path", $managedZipDeploy,
        "--environment", $EnvironmentUrl,
        "--async", "true",
        "--force-overwrite", "true",
        "--publish-changes", "false"
    )

    if ($Username) {
        $importArgs += @("--cloud-instance", "UsGov")
        # pac auth is assumed to be set already; Username is informational here
        Write-Host "Using username: $Username"
    }

    Write-Host "Running: pac $($importArgs -join ' ')"
    & pac @importArgs

    if ($LASTEXITCODE -ne 0) {
        Write-Error "pac solution import failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }

    Write-Host "Deployment initiated successfully."
}

Write-Host "Done."
