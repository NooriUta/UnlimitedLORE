# MCP LORE по адресу хоста — как переключить клиента

SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED. Владелица 19.11.2026: «мне надоело локально mcp пересобирать» → «mcp лучше по адресу lore host».

Раньше `aida-lore` запускался у каждого клиента локальным процессом (`node mcp-server/dist/index.js`), и каждую новую версию приходилось собирать руками. Теперь MCP — это сервис стенда `lore-mcp`. Он выкатывается вместе с LORE (LORE CD) и отвечает по адресу хоста:

| Что | Адрес |
|---|---|
| MCP (Streamable HTTP) | `https://<хост LORE>/mcp` |
| Проверка без входа | `https://<хост LORE>/mcp/health` → `{"status":"ok","commit":…,"built_at":…}` |

Препрод: `https://preprod.lore.odal.seidrstudio.pro/mcp`.

## Как устроен вход

- Каждый запрос к `/mcp` несёт `Authorization: Bearer <токен клиента>`. Без него сервер отвечает 401.
- В бэкенд MCP ходит **тем же** токеном. Права и скоуп поэтому такие же, как у агента при stdio-режиме. Своих учётных данных у сервера нет.
- Профиль поверхности задаёт заголовок `X-Lore-Mcp-Profile`: `full` (по умолчанию), `core`, `architect`, `developer`, `tester`, `pm`, `analyst`, `product-analyst` или `marketer`. Профиль задаётся при подключении и держится всю сессию. С неизвестным профилем сервер ответит 400 и перечислит допустимые. Поверхность сужается ещё и по `agent_scope` из токена, как в stdio.
- Необязательные заголовки наблюдаемости бэкенд получает как есть: `X-Lore-Machine`, `X-Lore-Harness`, `X-Lore-Session-Id`, `X-Lore-Act-As`.

## Откуда токен

Токен выдаёт Keycloak (realm `omilore`) по client_credentials клиента `lore-mcp-*` (например, `lore-mcp-full`). Это тот же клиент, что и в stdio-режиме. Клиентов и секреты заводит владелица. Секрет в репозиторий не коммитится.

Токен client_credentials живёт минуты. Поэтому статичный `Bearer ${LORE_MCP_TOKEN}` годится только для короткой проверки: посреди сессии он протухнет, и бэкенд начнёт отвечать 401. Для постоянной работы есть помощник `mcp-server/scripts/lore-mcp-headers.mjs`. При каждом запуске он берёт свежий токен и печатает JSON заголовков в формате `headersHelper`.

## `.mcp.json` / `~/.claude.json`

Короткая проверка (токен подставляется из окружения):

```json
{
  "mcpServers": {
    "aida-lore": {
      "type": "http",
      "url": "https://<хост LORE>/mcp",
      "headers": {
        "Authorization": "Bearer ${LORE_MCP_TOKEN}",
        "X-Lore-Mcp-Profile": "full"
      }
    }
  }
}
```

Постоянная работа (токен обновляет помощник; `LORE_OIDC_ISSUER`, `LORE_MCP_CLIENT_ID` и `LORE_MCP_CLIENT_SECRET` должны быть в окружении клиента):

```json
{
  "mcpServers": {
    "aida-lore": {
      "type": "http",
      "url": "https://<хост LORE>/mcp",
      "headersHelper": "node D:/Unlimitedlore/mcp-server/scripts/lore-mcp-headers.mjs"
    }
  }
}
```

Гипотеза, не проверено: Claude Code перезапускает `headersHelper` при переподключении, но не на каждый вызов. Если токен протух посреди сессии, переподключите сервер командой `/mcp` → reconnect.

## Проверка

```sh
curl -s https://<хост LORE>/mcp/health
# тот же набор вызовов, что у локального смоука, но против сервера по адресу (только чтение):
cd mcp-server && LORE_MCP_URL=https://<хост LORE>/mcp LORE_MCP_TOKEN=<токен> node scripts/mcp-smoke.mjs
```

Коммит в `/mcp/health` должен совпасть с `/lore/version` стенда: обе отметки берутся из `LORE_BUILD_COMMIT` одной выкатки.

## Как вернуться на stdio

Верните прежнюю запись `aida-lore` (`"command": "node", "args": ["mcp-server/dist/index.js"]` с `env`, см. `.mcp.json.example`) и соберите сервер: `cd mcp-server && npm ci && npm run build`. Режим по умолчанию — stdio: без `LORE_MCP_TRANSPORT=http` сервер работает как раньше.

## Что на стороне стенда

- Сервис `lore-mcp` в `docker-compose.yml` собирается из `mcp-server/Dockerfile`. В нём заданы `LORE_MCP_TRANSPORT=http` и порт 9200, а бэкенд берётся по адресу `http://lore-backend:9100`. Порта наружу нет.
- nginx фронта (общий `nginx.conf.template`, `lore-app` и `lore-app-next`) проксирует `location = /mcp` и `/mcp/` в `lore-mcp:9200`. Буферизация выключена (`proxy_buffering off`), протокол HTTP/1.1, `proxy_read_timeout 3600s`, тело запроса до 64m. Адрес задан переменной, поэтому без сервиса nginx всё равно поднимается, а `/mcp` отвечает 502.
- LORE CD: шаги «Build MCP image (lore-mcp)», «Deploy MCP (lore-mcp)» и «Probe /mcp/health через nginx v2», флаг `mcp` из `ci-scope.sh cd`. Ручной запуск `service=mcp` выкатывает только MCP.
- Сессия без запросов закрывается через 2 часа (`LORE_MCP_SESSION_IDLE_MS`). После рестарта контейнера клиент получает 404 по старой сессии и переподключается.
