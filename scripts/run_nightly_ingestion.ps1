param(
  [Parameter(Mandatory = $true)]
  [string]$InputFolder,

  [string]$ArchiveFolder = "$InputFolder\processed",
  [string]$FailedFolder = "$InputFolder\failed",
  [string]$PythonExe = ".\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $InputFolder)) {
  throw "Input folder does not exist: $InputFolder"
}

if (!(Test-Path -LiteralPath $ArchiveFolder)) {
  New-Item -ItemType Directory -Path $ArchiveFolder | Out-Null
}

if (!(Test-Path -LiteralPath $FailedFolder)) {
  New-Item -ItemType Directory -Path $FailedFolder | Out-Null
}

if (!(Test-Path -LiteralPath $PythonExe)) {
  throw "Python executable not found: $PythonExe. Create the venv and install scripts/requirements.txt first."
}

$files = Get-ChildItem -LiteralPath $InputFolder -Filter *.csv -File |
  Where-Object { $_.DirectoryName -ne $ArchiveFolder -and $_.DirectoryName -ne $FailedFolder } |
  Sort-Object LastWriteTime

foreach ($file in $files) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $targetName = "$($file.BaseName)-$timestamp$($file.Extension)"

  try {
    & $PythonExe scripts\ingest_taiga_csv.py $file.FullName --refresh-aggregates
    if ($LASTEXITCODE -ne 0) {
      throw "Ingestion returned exit code $LASTEXITCODE"
    }

    Move-Item -LiteralPath $file.FullName -Destination (Join-Path $ArchiveFolder $targetName)
  } catch {
    Write-Error "Failed to ingest $($file.FullName): $_"
    Move-Item -LiteralPath $file.FullName -Destination (Join-Path $FailedFolder $targetName)
  }
}

& $PythonExe scripts\learn_elasticity.py
