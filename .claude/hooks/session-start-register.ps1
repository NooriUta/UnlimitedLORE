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

    # Значения — из .mcp.json этого репо (aida-lore MCP-сервер), секрет — из
    # машинного env (setx, не литерал в файле).
    $issuer = 'https://odal.seidrstudio.pro/kc/realms/omilore'
    $clientId = 'lore-mcp-full'
    $clientSecret = $env:LORE_MCP_CLIENT_SECRET
    $backend = 'https://lore.odal.seidrstudio.pro'

    if (-not $clientSecret) { Write-Log 'LORE_MCP_CLIENT_SECRET not set, skip'; exit 0 }

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

    Write-Log "registered session=$sessionId actor=$actorId"
} catch {
    $detail = $_.ErrorDetails.Message
    Write-Log "failed: $($_.Exception.Message) $detail"
}

exit 0
