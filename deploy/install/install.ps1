# Вход установщика LORE для Windows — SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE.
# Слово владелицы 22.11.2026: «собирай установщик под windows и linux».
#
#   .\install.ps1 --version v1.18.2            # как install.sh, ключи те же
#   .\install.ps1 --verify
#   .\install.ps1 --selftest
#   .\install.ps1 -ShowPlan --version v1.18.2  # только показать, чем и как будет запущено
#
# ПОЧЕМУ ЭТО ЗАПУСКАЛКА, А НЕ ВТОРОЙ УСТАНОВЩИК. Пакет LORE состоит из docker compose, и в нём НЕТ привязок к
# путям хоста — только именованные тома. Поэтому под Windows работает тот же install.sh, что под Linux: разница
# лишь в том, чем его запустить. Переписать 1218 строк на PowerShell значило бы иметь две реализации, которые
# расходятся молча, и вторую из них никто не проверяет. Здесь вместо этого — проверки окружения и один запуск.
#
# Запускается через WSL (его требует сам Docker Desktop) либо через bash из Git для Windows. Если нет ни того,
# ни другого — громкий отказ с тем, что поставить, а не тихая попытка «как-нибудь».
[CmdletBinding()]
param(
  [switch]$ShowPlan,
  [Parameter(ValueFromRemainingArguments = $true)] [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$script:Dir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step { param([string]$m) Write-Host "==> $m" }
function Write-Block {
  param([string]$what, [string]$why, [string]$how)
  Write-Host ''
  Write-Host 'BLOCKED: ' -NoNewline -ForegroundColor Red; Write-Host $what
  Write-Host "  зачем: $why"
  Write-Host "  как разблокировать: $how"
  Write-Host ''
}

# --- 1. Docker. Без него ставить нечего, и сказать это надо до любых действий.
function Test-Docker {
  $exe = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $exe) {
    Write-Block 'не найден docker' `
      'LORE целиком состоит из контейнеров: без docker ставить нечего' `
      'установите Docker Desktop (https://docs.docker.com/desktop/install/windows-install/) и запустите его'
    return $false
  }
  $srv = (& docker version --format '{{.Server.Version}}' 2>&1 | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or -not $srv -or $srv -match 'error|cannot|denied') {
    Write-Block 'docker установлен, но служба не отвечает' `
      'клиент есть, демона нет — установка упала бы на первом же образе' `
      'запустите Docker Desktop и дождитесь, пока значок перестанет мигать; затем повторите'
    return $false
  }
  $os = (& docker version --format '{{.Server.Os}}' 2>&1 | Select-Object -Last 1)
  if ($os -and $os -ne 'linux') {
    Write-Block "docker работает в режиме контейнеров «$os»" `
      'образы LORE — Linux; в режиме Windows-контейнеров они не запустятся' `
      'в Docker Desktop: «Switch to Linux containers» в меню значка'
    return $false
  }
  Write-Step "docker на связи: сервер $srv, контейнеры $os"
  return $true
}

# --- 2. Чем запускать bash. Порядок намеренный: WSL первым, потому что его требует сам Docker Desktop,
#        а значит он почти наверняка есть; Git Bash — запасной путь для машин с Hyper-V без WSL.
function Resolve-Bash {
  $wsl = Get-Command wsl -ErrorAction SilentlyContinue
  if ($wsl) {
    & wsl -e bash -lc 'command -v docker >/dev/null 2>&1' 2>$null
    if ($LASTEXITCODE -eq 0) { return @{ Kind = 'wsl'; Path = $wsl.Source } }
    # WSL есть, но docker внутри не виден — чаще всего выключена интеграция дистрибутива.
    Write-Host 'WSL найден, но docker внутри него не виден — пробую Git Bash' -ForegroundColor Yellow
  }
  foreach ($p in @(
      "$env:ProgramFiles\Git\bin\bash.exe",
      "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
      "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")) {
    if (Test-Path $p) { return @{ Kind = 'gitbash'; Path = $p } }
  }
  $g = Get-Command bash -ErrorAction SilentlyContinue
  if ($g) { return @{ Kind = 'gitbash'; Path = $g.Source } }
  return $null
}

# Путь Windows → путь внутри WSL: C:\lore → /mnt/c/lore. Пробелы не трогаем: путь уходит одним аргументом.
function Convert-PathToWsl {
  param([string]$p)
  $full = [System.IO.Path]::GetFullPath($p)
  $drive = $full.Substring(0, 1).ToLowerInvariant()
  return '/mnt/' + $drive + ($full.Substring(2) -replace '\\', '/')
}

$script:Sh = Join-Path $script:Dir 'install.sh'
if (-not (Test-Path $script:Sh)) {
  Write-Block 'рядом нет install.sh' `
    'запускалка не содержит самой установки — она запускает тот же сценарий, что под Linux' `
    'распакуйте архив пакета целиком и запускайте install.ps1 из той же папки'
  exit 2
}

$bash = Resolve-Bash
if (-not $bash) {
  Write-Block 'не найден ни WSL, ни bash из Git для Windows' `
    'сценарий установки — bash; запускать его нечем' `
    'включите WSL (`wsl --install`, нужен перезапуск) либо поставьте Git для Windows (https://git-scm.com/download/win)'
  exit 2
}

if ($bash.Kind -eq 'wsl') {
  $script:Cmd = 'wsl'
  $script:Args = @('-e', 'bash', (Convert-PathToWsl $script:Sh)) + $Rest
} else {
  $script:Cmd = $bash.Path
  $script:Args = @($script:Sh) + $Rest
}

if ($ShowPlan) {
  Write-Host "запуск: $script:Cmd $($script:Args -join ' ')"
  Write-Host "способ: $($bash.Kind)"
  exit 0
}

# Самопроверка пакета docker не требует: она читает файлы и ничего не ставит.
$needDocker = -not ($Rest -contains '--selftest')
if ($needDocker -and -not (Test-Docker)) { exit 2 }

Write-Step "запускаю установку через $($bash.Kind)"
& $script:Cmd @script:Args
exit $LASTEXITCODE
