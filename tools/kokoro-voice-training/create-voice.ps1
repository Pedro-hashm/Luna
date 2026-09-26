[CmdletBinding()]
param(
  [string]$VoiceId = "pf_luna_user_pt"
)

$ErrorActionPreference = "Stop"

if ($VoiceId -notmatch '^p[fm]_[A-Za-z0-9_-]{1,80}$') {
  throw "VoiceId precisa começar com pf_ ou pm_ e conter apenas letras, números, _ ou -."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$samplePath = Join-Path $env:USERPROFILE "Downloads\Luna-Voice.mp3"
if (-not (Test-Path -LiteralPath $samplePath -PathType Leaf)) {
  throw "Não encontrei a amostra: $samplePath"
}

$apiContainer = "luna-v2-api"
$kokoroContainer = "luna-v2-kokoro"
foreach ($container in @($apiContainer, $kokoroContainer)) {
  docker inspect $container *> $null
  if ($LASTEXITCODE -ne 0) { throw "Inicie a Luna com docker compose up -d antes de gerar o pack." }
}

docker exec $kokoroContainer python -c "import os,sys; sys.exit(0 if os.path.exists('/voices/$VoiceId.pt') else 1)" *> $null
if ($LASTEXITCODE -eq 0) { throw "O pack /voices/$VoiceId.pt já existe. Escolha outro -VoiceId para não sobrescrevê-lo." }
if ($LASTEXITCODE -ne 1) { throw "Não consegui verificar o volume de voice packs." }

$outputDir = Join-Path $PSScriptRoot "output"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$cacheVolume = docker inspect --format '{{range .Mounts}}{{if eq .Destination "/root/.cache"}}{{.Name}}{{end}}{{end}}' $kokoroContainer
$voiceVolume = docker inspect --format '{{range .Mounts}}{{if eq .Destination "/voices"}}{{.Name}}{{end}}{{end}}' $apiContainer
if (-not $cacheVolume -or -not $voiceVolume) { throw "Não encontrei os volumes de cache do Kokoro e de voice packs da Luna." }

$sampleMount = "type=bind,source=$samplePath,target=/input/Luna-Voice.mp3,readonly"
$outputMount = "type=bind,source=$outputDir,target=/output"
$cacheMount = "type=volume,source=$cacheVolume,target=/root/.cache"

Push-Location $repoRoot
try {
  docker build --file tools/kokoro-voice-training/Dockerfile --tag luna-v2-kokoro-voice-training:local .
  if ($LASTEXITCODE -ne 0) { throw "Falha ao criar a imagem isolada do afinador." }

  docker run --rm --gpus all --mount $sampleMount --mount $outputMount --mount $cacheMount `
    luna-v2-kokoro-voice-training:local `
    --input /input/Luna-Voice.mp3 --output "/output/$VoiceId.pt" --voice-id $VoiceId --device cuda
  if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o voice pack." }
} finally {
  Pop-Location
}

$packPath = Join-Path $outputDir "$VoiceId.pt"
docker cp $packPath "${apiContainer}:/voices/$VoiceId.pt"
if ($LASTEXITCODE -ne 0) { throw "O pack foi gerado, mas não consegui instalá-lo no volume de vozes do Kokoro." }

$portBinding = docker port $kokoroContainer "8000/tcp" | Select-Object -First 1
if ($portBinding -notmatch ':(\d+)$') { throw "Não encontrei a porta publicada pelo Kokoro." }
$ttsUrl = "http://127.0.0.1:$($Matches[1])/v1/audio/speech"
$previewPath = Join-Path $outputDir "$VoiceId-preview.wav"
$body = @{
  model = "kokoro"
  input = "Ola, esta e uma frase curta para conferir minha voz no Kokoro."
  voice = "pack://$VoiceId"
  response_format = "wav"
  speed = 1.0
} | ConvertTo-Json -Compress
Invoke-WebRequest -Uri $ttsUrl -Method Post -ContentType "application/json" -Body $body -OutFile $previewPath

Write-Host "Pack Kokoro instalado: /voices/$VoiceId.pt"
Write-Host "Prévia gerada pela API Kokoro: $previewPath"
