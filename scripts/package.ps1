$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectDirectory 'dist'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$archivePath = Join-Path $outputDirectory 'DiscordRichCards.zip'
Compress-Archive -LiteralPath (Join-Path $projectDirectory 'vencord\discordRichCards') -DestinationPath $archivePath -Force
Write-Output $archivePath
