# MCP LORE по адресу хоста — как переключить клиента

SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED. Владелица 19.11.2026: «мне надоело локально mcp пересобирать» → «mcp лучше по адресу lore host».

Раньше `aida-lore` запускался у каждого клиента локальным процессом (`node mcp-server/dist/index.js`), и каждую новую версию приходилось собирать руками. Теперь MCP — это сервис стенда `lore-mcp`. Он выкатывается вместе с LORE (LORE CD) и отвечает по адресу хоста:

| Что | Адрес |
|---|---|
| MCP (Streamable HTTP) | `https://<хост LORE>/mcp` |
| Проверка без входа | `https://<хост LORE>/mcp/health` → `{"status":"ok","commit":…,"built_at":…}` |

Препрод: `https://preprod.lore.odal.seidrstudio.pro/mcp`.

## Как устроен вход

- Каждый запрос к `/mcp` несёт вход одним из двух способов:
  - `Authorization: Bearer <токен клиента>` — для клиентов с `headersHelper` (Claude Code, см. ниже);
  - пара `X-Lore-Client-Id` + `X-Lore-Client-Secret` — для клиентов со статичными заголовками (OpenCode и другие). Токен по паре берёт у Keycloak сам сервер: client_credentials, тот же token endpoint, что у stdio-режима (`<LORE_OIDC_ISSUER>/protocol/openid-connect/token`). Токен кэшируется до истечения минус 60 с; ключ кэша — client_id плюс хэш секрета, поэтому неверный секрет не получит чужой токен из кэша. Секрет не пишется ни в журнал, ни в ответ.
  - Если пришло и то и другое, Bearer важнее. Нет ни того, ни другого — 401 с подсказкой. Неполная пара — 401 с именем недостающего заголовка. Keycloak отказал — 401. Keycloak недоступен — 502. У сервера нет `LORE_OIDC_ISSUER` — 503.
- В бэкенд MCP ходит полученным токеном. Права и скоуп поэтому такие же, как у агента при stdio-режиме. Своих учётных данных у сервера нет: из настроек ему нужен только `LORE_OIDC_ISSUER`, а это адрес realm, не секрет.
- `Mcp-Session-Id` — номер сессии транспорта. Он меняется при каждом переподключении (проба 19.11), поэтому сессией агента не считается и как `X-Lore-Session-Id` в бэкенд не уходит.
- Профиль поверхности задаёт заголовок `X-Lore-Mcp-Profile`: `full` (по умолчанию), `core`, `architect`, `developer`, `tester`, `pm`, `analyst`, `product-analyst` или `marketer`. Профиль задаётся при подключении и держится всю сессию. С неизвестным профилем сервер ответит 400 и перечислит допустимые. Поверхность сужается ещё и по `agent_scope` из токена, как в stdio.
- Необязательные заголовки наблюдаемости бэкенд получает как есть: `X-Lore-Machine`, `X-Lore-Harness`, `X-Lore-Session-Id`, `X-Lore-Act-As`.

## Откуда токен

Токен выдаёт Keycloak (realm `omilore`) по client_credentials клиента `lore-mcp-*` (например, `lore-mcp-full`). Это тот же клиент, что и в stdio-режиме. Клиентов и секреты заводит владелица. Секрет в репозиторий не коммитится.

Токен client_credentials живёт минуты. Поэтому статичный `Bearer ${LORE_MCP_TOKEN}` годится только для короткой проверки: посреди сессии он протухнет, и бэкенд начнёт отвечать 401. Для постоянной работы есть два пути:

- **Claude Code** — помощник `mcp-server/scripts/lore-mcp-headers.mjs` в `headersHelper`. Проба 19.11: Claude Code запускает помощник при подключении и после 401, сам берёт новые заголовки и повторяет вызов. Помощник печатает JSON заголовков `Authorization`, `X-Lore-Machine` (по умолчанию имя машины), `X-Lore-Harness` (по умолчанию `claude-code`) и `X-Lore-Mcp-Profile`. Токен кэшируется в файле пользователя `~/.lore/mcp-token.json` (путь меняет `LORE_MCP_TOKEN_CACHE`), секрет в файл не пишется. Номер сессии Claude Code в помощник не приходит, поэтому `X-Lore-Session-Id` он не выдаёт.
- **OpenCode и другие клиенты без помощника** — пара `X-Lore-Client-Id` / `X-Lore-Client-Secret` в заголовках, токен берёт сервер.

`LORE_OIDC_ISSUER` у клиента должен указывать на realm стенда: прод — `…/realms/omilore`, препрод — `…/realms/omilorePreprod`. Токен другого realm стенд не примет. Для пары id/секрет это не нужно: realm знает сервер.

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

Постоянная работа (токен обновляет помощник; `LORE_OIDC_ISSUER`, `LORE_MCP_CLIENT_ID` и `LORE_MCP_CLIENT_SECRET` должны быть в окружении клиента; `LORE_MACHINE_ID` и `LORE_HARNESS` — по желанию):

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

Протухший токен помощник заменит сам: после 401 Claude Code запускает его снова (проба 19.11). Кэш в файле отдаёт токен, только пока до истечения больше 60 с.

## `opencode.json` (вход парой id/секрет)

`{env:…}` OpenCode подставляет из окружения. Клиент Keycloak — свой у каждого harness (`lore-mcp-full_<harness>`), чужой приписал бы действия не тому агенту.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "aida-lore": {
      "type": "remote",
      "url": "https://<хост LORE>/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "X-Lore-Client-Id": "{env:LORE_MCP_CLIENT_ID}",
        "X-Lore-Client-Secret": "{env:LORE_MCP_CLIENT_SECRET}",
        "X-Lore-Mcp-Profile": "full",
        "X-Lore-Harness": "opencode",
        "X-Lore-Machine": "{env:LORE_MACHINE_ID}"
      }
    }
  }
}
```

Гипотеза, не проверено на живом OpenCode: `"oauth": false` нужен, чтобы OpenCode на первый 401 не запускал свой OAuth-поиск. Секрет едет в каждом запросе, поэтому адрес — только `https://`.

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

- Сервис `lore-mcp` в `docker-compose.yml` собирается из `mcp-server/Dockerfile`. В нём заданы `LORE_MCP_TRANSPORT=http` и порт 9200, а бэкенд берётся по адресу `http://lore-backend:9100`. `LORE_OIDC_ISSUER` приходит тот же, что у бэкенда (на препроде — realm `omilorePreprod`). Порта наружу нет.
- nginx фронта (общий `nginx.conf.template`, `lore-app` и `lore-app-next`) проксирует `location = /mcp` и `/mcp/` в `lore-mcp:9200`. Буферизация выключена (`proxy_buffering off`), протокол HTTP/1.1, `proxy_read_timeout 3600s`, тело запроса до 64m. Адрес задан переменной, поэтому без сервиса nginx всё равно поднимается, а `/mcp` отвечает 502.
- LORE CD: шаги «Build MCP image (lore-mcp)», «Deploy MCP (lore-mcp)» и «Probe /mcp/health через nginx v2», флаг `mcp` из `ci-scope.sh cd`. Ручной запуск `service=mcp` выкатывает только MCP.
- Сессия без запросов закрывается через 2 часа (`LORE_MCP_SESSION_IDLE_MS`). После рестарта контейнера клиент получает 404 по старой сессии и переподключается.
