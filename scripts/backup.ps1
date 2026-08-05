# Weekly backup — SAMPARK_BUILD_PLAN.md section 8, Phase 6.
#
#   powershell -File scripts/backup.ps1 [-OutDir "D:\claude\backups\sampark"]
#
# Neon's own point-in-time restore is the first line of defence and covers the
# "someone approved the wrong thing an hour ago" case. This covers the one PITR
# cannot: the Neon project itself going away, or a retention window quietly
# elapsing. A dump on a drive you control is the difference between an incident
# and a disaster.
#
# WHAT THIS FILE PRODUCES CONTAINS EVERY STUDENT'S NAME, PHONE NUMBER AND
# AADHAAR NUMBER. Keep it off the repo and off any shared drive. The default
# output directory is on D: and is deliberately not inside the project.
#
# Requires pg_dump (PostgreSQL client tools) on PATH. Reads the connection
# string from .env.local, which is gitignored.

param(
  [string]$OutDir = "D:\claude\backups\sampark",
  [int]$KeepDays = 60
)

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\.env.local"
if (-not (Test-Path $envFile)) {
  throw ".env.local not found — cannot read the connection string."
}

# The unpooled owner connection: a dump needs to read every table, and the
# pooler is not the right endpoint for a long-running single session.
$line = Select-String -Path $envFile -Pattern '^DATABASE_URL_UNPOOLED=(.+)$' |
  Select-Object -First 1
if (-not $line) { throw "DATABASE_URL_UNPOOLED is not set in .env.local" }
$conn = $line.Matches[0].Groups[1].Value.Trim().Trim('"')

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "pg_dump is not on PATH. Install the PostgreSQL client tools."
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stamp = Get-Date -Format "yyyy-MM-dd-HHmm"
$file  = Join-Path $OutDir "sampark-$stamp.dump"

Write-Host "Dumping to $file"
# Custom format: compressed, and restorable table-by-table with pg_restore,
# which is what you actually want when one table got mangled.
& pg_dump --format=custom --no-owner --no-privileges --file=$file $conn
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

$size = [math]::Round((Get-Item $file).Length / 1MB, 2)
Write-Host "Wrote $file ($size MB)"

# A backup nobody has ever restored is a rumour. Verify the dump is readable.
& pg_restore --list $file | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The dump is not readable by pg_restore." }
Write-Host "Verified: pg_restore can read the dump."

$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -Path $OutDir -Filter "sampark-*.dump" |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    Write-Host "Removing old backup $($_.Name)"
    Remove-Item $_.FullName -Confirm:$false
  }

Write-Host "Done."
