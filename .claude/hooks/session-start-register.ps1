# AL-110/ADR-LORE-037 V1: SessionStart-хук — сессия регистрирует себя в
# KnowAgentSession (POST /lore/actor/session) при каждом старте/резюме.
#
# Почему хук, а не «попроси модель вызвать инструмент»: модель может забыть,
# пропустить, или решить что «не сейчас». Хук — часть харнесса, срабатывает
# детерминированно на каждый SessionStart (startup/resume/clear/compact/fork),
# без зависимости от того, вспомнит ли сессия об этом сама.
#
# actor_id резолвится ЗДЕСЬ, запросом к слайсу agent_owners по client_id —
# не на бэкенде через клейм токена. Бэкенд УМЕЕТ резолвить сам (см.
# LoreProductResource.logAgentSession, actor_id опционален), но проверено
# эмпирически 2026-08-16: на этом стенде lore.scope.enforce выключен, JWT в
# SecurityIdentity не парсится ни для одного эндпоинта, и серверный резолв
# по client_id молча возвращает 400 "actor_id required" даже с валидным
# Bearer-токеном. Когда скоуп включат — можно убрать этот шаг, бэкенд уже
# готов; до того резолв только здесь.
#
# SessionStart — fire-and-forget (не блокирует и не может остановить старт
# сессии, см. официальную схему хука): любая ошибка здесь тихо уходит в лог,
# никогда не всплывает в разговоре и никогда не роняет exit code.

$ErrorActionPreference = 'Stop'
$logFile = Join-Path $PSScriptRoot 'session-start-register.log'

function Write-Log($msg) {
    try { Add-Content -Path $logFile -Value "$(Get-Date -Format o) $msg" -Encoding utf8 } catch {}
}

try {
    $stdin = [Console]::In.ReadToEnd()
    $payload = $stdin | ConvertFrom-Json

    $sessionId = $payload.session_id
    if (-not $sessionId) { Write-Log 'no session_id on stdin, skip'; exit 0 }

    # Учётка — ТА ЖЕ, под которой ходит MCP-сервер aida-lore: его запись в
    # user-скоупе Claude Code (~/.claude.json → mcpServers.aida-lore.env).
    # Один источник секрета: 13.11.2026 у хука был свой (env
    # LORE_MCP_CLIENT_SECRET), у MCP свой — после смены секрета клиента они
    # разошлись, и хук молча падал 401 при живом MCP. Переменная окружения
    # осталась запасным путём — для машины без записи в ~/.claude.json.
    # Клиент — lore-mcp-full (Claude Code); у других harness свой
    # lore-mcp-full_<harness>, и чужим этот хук не пользуется.
    $issuer = 'https://odal.seidrstudio.pro/kc/realms/omilore'
    $clientId = 'lore-mcp-full'
    $clientSecret = $null
    $backend = 'https://lore.odal.seidrstudio.pro'
    $source = 'env'
    try {
        # ConvertFrom-Json (PowerShell 5) падает на ~/.claude.json: в projects
        # есть ключи, различающиеся только регистром ('C:/BlackPerl' и
        # 'C:/blackperl'). JavaScriptSerializer регистр различает.
        Add-Type -AssemblyName System.Web.Extensions
        $js = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $js.MaxJsonLength = [int]::MaxValue
        $cfg = $js.DeserializeObject([IO.File]::ReadAllText((Join-Path $env:USERPROFILE '.claude.json')))
        $lore = $null
        if ($cfg.ContainsKey('mcpServers') -and $cfg['mcpServers'].ContainsKey('aida-lore')) { $lore = $cfg['mcpServers']['aida-lore']['env'] }
        if ($lore -and $lore['LORE_MCP_CLIENT_SECRET']) {
            if ($lore['LORE_MCP_CLIENT_ID']) { $clientId = $lore['LORE_MCP_CLIENT_ID'] }
            if ($lore['LORE_OIDC_ISSUER']) { $issuer = $lore['LORE_OIDC_ISSUER'] }
            $clientSecret = $lore['LORE_MCP_CLIENT_SECRET']
            $source = '~/.claude.json'
        }
    } catch { Write-Log "user-scope aida-lore not readable ($($_.Exception.Message)), fallback to env" }
    if (-not $clientSecret) { $clientSecret = $env:LORE_MCP_CLIENT_SECRET }

    if (-not $clientSecret) { Write-Log 'no aida-lore secret (~/.claude.json, env LORE_MCP_CLIENT_SECRET), skip'; exit 0 }

    $tokenResp = Invoke-RestMethod -Method Post -Uri "$issuer/protocol/openid-connect/token" `
        -ContentType 'application/x-www-form-urlencoded' `
        -Body @{ grant_type = 'client_credentials'; client_id = $clientId; client_secret = $clientSecret } `
        -TimeoutSec 10
    $authHeaders = @{ Authorization = "Bearer $($tokenResp.access_token)"; 'X-Seer-Role' = 'admin' }

    $owners = Invoke-RestMethod -Method Get -Uri "$backend/lore/slice/agent_owners" `
        -Headers $authHeaders -TimeoutSec 10
    $mine = $owners.rows | Where-Object { $_.client_id -eq $clientId } | Select-Object -First 1
    if (-not $mine) { Write-Log "no KnowActor with client_id=$clientId, skip"; exit 0 }
    $actorId = $mine.actor_id

    # Проба без записи: учётка принята, актор найден — сессию не регистрируем.
    if ($env:LORE_HOOK_DRYRUN -eq '1') { Write-Log "dry-run ok: client=$clientId source=$source actor=$actorId"; exit 0 }

    $body = @{
        session_id = $sessionId
        actor_id   = $actorId
        machine_id = $env:COMPUTERNAME
    }
    if ($payload.cwd) {
        # Проектный слаг — последний сегмент cwd, тот же приём, что уже
        # использует miniLORE-гейтвей (sessions.ts projectDisplayName): точная
        # git_project-привязка не нужна здесь, это ориентир «где физически
        # работает сессия», не запись в BELONGS_TO_PROJECT.
        $body.project = ($payload.cwd -split '[\\/]' | Where-Object { $_ } | Select-Object -Last 1)
    }

    Invoke-RestMethod -Method Post -Uri "$backend/lore/actor/session" `
        -Headers $authHeaders `
        -ContentType 'application/json' `
        -Body ($body | ConvertTo-Json) `
        -TimeoutSec 10 | Out-Null

    Write-Log "registered session=$sessionId actor=$actorId source=$source"
} catch {
    $detail = $_.ErrorDetails.Message
    Write-Log "failed (client=$clientId source=$source): $($_.Exception.Message) $detail"
}

exit 0
