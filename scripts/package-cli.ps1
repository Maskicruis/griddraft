param(
  [Parameter(Mandatory=$true)][string]$NodeLicense,
  [string]$Output = 'dist'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe -ErrorAction Stop).Source
$runtime = (& $node --version).Trim()
if ($runtime -ne 'v24.16.0') { throw 'Use Node v24.16.0 with the matching license file for this Windows bundle.' }
$metadata = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$target = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $target -Force | Out-Null
$stage = Join-Path $target ('cli-stage-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($file in @('bin','src','examples','schema','docs','LICENSE','README.md','THIRD_PARTY.md','package.json','package-lock.json')) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stage -Recurse
}
npm ci --prefix $stage --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Installing packaged runtime dependencies failed.' }
Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'node.exe')
Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $stage 'LICENSE.node.txt')
$launcher = @'
@echo off
"%~dp0node.exe" "%~dp0bin/griddraft.cjs" %*
exit /b %errorlevel%
'@
[IO.File]::WriteAllText((Join-Path $stage 'griddraft.cmd'), ($launcher -replace "`r?`n","`r`n")+"`r`n",[Text.Encoding]::ASCII)
$zip = Join-Path $target ("GridDraft-CLI-"+$metadata.version+"-windows-x64.zip")
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
Write-Output $zip
