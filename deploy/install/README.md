# Установка LORE на Linux

Самодостаточная установка LORE на чистую машину: своя ArcadeDB, бэкенд, веб-интерфейс v2 и MinIO для вложений. От нашей инфраструктуры (Keycloak, Infisical, Forgejo, Traefik) не зависит. Вход через Keycloak, встройка Völva и Forgejo с forgejo-mcp — по выбору (см. ниже).

## Требования

- Linux x86_64, 4 ГБ RAM и 10 ГБ диска (сборка образов — основная нагрузка).
- Docker Engine 24+ с плагином `docker compose` v2, пользователь в группе `docker`.
- `git` — если ставите конкретный тег (`--version`).
- Доступ в интернет к Docker Hub, Maven Central и npm (для сборки образов).
- Свободный порт веб-интерфейса (по умолчанию 4400).

## Установка одной строкой

Из клона репозитория:

```bash
git clone <url-репозитория> lore && cd lore && git fetch --tags
bash deploy/install/install.sh --dir /opt/lore --version v1.17.21
```

Без `--version` образы собираются из текущего состояния клона. Если образы уже есть в вашем реестре, сборку можно пропустить:

```bash
LORE_BACKEND_IMAGE=registry.example/lore-backend:v1.17.21 \
LORE_WEB_IMAGE=registry.example/lore-web:v1.17.21 \
bash deploy/install/install.sh --dir /opt/lore
```

Свои пароли вместо сгенерированных задаются переменными `ARCADEDB_ROOT_PASSWORD` и `MINIO_PASSWORD`. Посмотреть план без изменений можно флагом `--dry-run`.

Первый старт на пустой базе занимает несколько минут: бэкенд сам поднимает ядро схемы и накатывает все шаги миграций. Флаг `LORE_BOOTSTRAP` не нужен.

## Обновление

Тот же запуск с новым тегом в тот же каталог:

```bash
bash deploy/install/install.sh --dir /opt/lore --version v1.18.0
```

Пароли из `.env` сохраняются. Перед накаткой новых шагов схемы бэкенд снимает бэкап базы в том `lore-db-backups`.

## Удаление

```bash
bash deploy/install/install.sh --dir /opt/lore --uninstall          # остановить, данные сохранить
bash deploy/install/install.sh --dir /opt/lore --uninstall --purge  # стереть всё, включая данные
```

## Что создаётся

- Каталог установки (`/opt/lore` по умолчанию, права 700):
  - `docker-compose.yml` — копия `docker-compose.install.yml`;
  - `.env` (права 600) — версия, пароли, порт;
  - `src/<тег>/` — исходники тега, из которых собраны образы.
- Контейнеры проекта compose `lore`: `arcadedb`, `minio`, `lore-backend`, `lore-app-next`.
- Тома: `lore_lore-db` (база), `lore_lore-db-backups` (бэкапы перед миграциями), `lore_lore-minio-data` (вложения).
- Наружу открыт только веб-интерфейс, по умолчанию на `127.0.0.1:4400`. База и бэкенд портов не публикуют.

## Проверка

Инсталлятор сам проверяет результат в конце. Повторить проверку:

```bash
bash deploy/install/install.sh --dir /opt/lore --verify
```

Проверяются здоровье бэкенда (`/q/health/ready`, `/lore/version`), непустой справочник `dictionary`, продуктовые слайсы `features`, `use_cases_of_feature`, `pains`, `gains`, `jobs`, `actors`, `asset_orphans` и поиск `/lore/search`. Запросы идут через веб-интерфейс, поэтому заодно проверяется его прокси к бэкенду.

## Безопасность

В этом профиле аутентификации нет (`LORE_AUTH_ENABLED=false`): любой, кто достучался до порта, читает и пишет данные. Поэтому порт по умолчанию слушает только localhost. Чтобы открыть LORE в сеть, поставьте перед ним reverse proxy с TLS и авторизацией и задайте `LORE_PUBLIC_URL`. Значение `--bind 0.0.0.0` выставляйте только осознанно.

## Forgejo и forgejo-mcp — по выбору

Три варианта, по умолчанию — без Forgejo, как раньше:

```bash
bash deploy/install/install.sh --version v1.18.0 --forgejo install                                   # поставить Forgejo 15.0.5
bash deploy/install/install.sh --version v1.18.0 --forgejo own --forgejo-url https://git.example.org  # свой Forgejo
bash deploy/install/install.sh --version v1.18.0 --forgejo none                                      # без Forgejo
```

- **install** — пакет поднимает Forgejo 15.0.5 (та же версия, что на нашем стенде; образ `codeberg.org/forgejo/forgejo`) и forgejo-mcp. Профили compose `forgejo` и `forgejo-mcp`, веб Forgejo — на `127.0.0.1:3000`. Администратора Forgejo вы заводите сами в его первом окне.
- **own** — Forgejo не ставится. Адрес вашего Forgejo уходит в forgejo-mcp (`FORGEJO_URL`), профиль compose — только `forgejo-mcp`.
- **none** — профили Forgejo снимаются, мост LORE отвечает 503, как без Forgejo.

В вариантах install и own в пакет входит **forgejo-mcp**: репозиторий `AIDA/forgejo-mcp`, версия 0.1.7 (форк `@ric_/forgejo-mcp` с инструментами Actions/CI). Исходники прибиты к коммиту `bbe9f59c`.

Образ forgejo-mcp ни в какой реестр не публикуется. Он едет в пакете установщика архивом `images/forgejo-mcp-bbe9f59c.tar` с файлом `.tar.sha256`, в том же каталоге версии, что и установщик. Положите каталог `images/` рядом с `install.sh`. Порядок выбора образа:

1. `FORGEJO_MCP_IMAGE` — ваш готовый образ, перекрывает всё остальное.
2. Архив из `images/` — `docker load`, только если sha256 сходится. При несовпадении установка останавливается.
3. `--forgejo-mcp-build` — сборка из git на том же коммите. Это запасной путь, нужен доступ к репозиторию.

Если нет ни одного из трёх, инсталлятор отказывается и называет причину. Агенты подключаются по HTTP: `http://127.0.0.1:4430/mcp` с заголовком `Authorization: Bearer ${FORGEJO_MCP_API_KEY}`.

После установки:

1. Создайте в Forgejo два токена (Настройки → Приложения, права на репозитории): один для моста LORE, другой для forgejo-mcp.
2. Впишите их в `.env` установки как `FORGEJO_API_TOKEN` и `FORGEJO_MCP_TOKEN`.
3. Повторите `install.sh` в тот же каталог. Это обновление: пароли сохраняются, поднимается forgejo-mcp.

Пока `FORGEJO_MCP_TOKEN` пуст, forgejo-mcp не запускается, и инсталлятор пишет об этом предупреждение.

Проект в LORE регистрируется с адресом репозитория: `<адрес Forgejo>/<организация>/<репозиторий>`. Из этого адреса мост берёт организацию и репозиторий. При своей установке Forgejo используйте `http://localhost:3000/...`: бэкенд из контейнера ходит на этот адрес через `forgejo:3000` (`FORGEJO_BASE_OVERRIDE`).

## Секреты рантайма

Здесь перечислено всё, что читает работающая установка. Секреты, нужные только для разработки, сюда не входят. Значения нигде не печатаются: инсталлятор пишет их в `.env` (права 600) и на экран не выводит. Колонка «где читается» — файл в этом репозитории, где переменную берёт рантайм. Перечень сверяет тест `scripts/model-migration/installer-forgejo.test.mjs` в обе стороны с compose и `.env.example`.

| секрет | зачем | кто создаёт | где хранится | обязателен | как сменить | где читается |
|---|---|---|---|---|---|---|
| `ARCADEDB_ROOT_PASSWORD` | пароль root ArcadeDB: бэкенд ходит в базу, инсталлятор создаёт базу | установщик генерирует (или ваше значение из окружения) | `.env` 600; внутри тома `lore-db` | всегда | сменить пароль root в ArcadeDB, затем значение в `.env`, `docker compose up -d` | `deploy/install/docker-compose.install.yml`, `backend/src/main/resources/application.properties`, `deploy/install/install.sh` |
| `MINIO_PASSWORD`, `MINIO_ROOT_PASSWORD`, `S3_SECRET_KEY` | пароль MinIO (вложения); в контейнер MinIO идёт как `MINIO_ROOT_PASSWORD`, в бэкенд — как `S3_SECRET_KEY` | установщик генерирует | `.env` 600 | всегда | новое значение в `.env` и `docker compose up -d`: MinIO и бэкенд берут его вместе | `deploy/install/docker-compose.install.yml`, `backend/src/main/resources/application.properties` |
| `S3_ACCESS_KEY` | имя учётки MinIO (`MINIO_USER`) — не секрет, но читается рядом с паролем | установщик (по умолчанию `lore`) | `.env` | всегда | вместе с паролем MinIO | `deploy/install/docker-compose.install.yml`, `backend/src/main/resources/application.properties` |
| `LORE_VOLVA_EMBED_ES256_PRIVATE_KEY` | закрытый ключ подписи встройки Völva (ES256, PKCS#8) | окно установщика («Ключи Völva») | файл `volva-embed.env` 600, затем `.env` 600 | если выбрана Völva | новая пара в окне установщика, обе строки в `.env`, `up -d`; Völva перечитает `/lore/embed/jwks` | `deploy/install/docker-compose.install.yml`, `backend/src/main/java/studio/seer/heimdall/lore/AidaLoreResource.java` |
| `LORE_VOLVA_EMBED_ES256_PUBLIC_KEY` | открытый ключ пары, отдаётся в `/lore/embed/jwks`; не секрет | окно установщика, вместе с закрытым | `.env` | если выбрана Völva | вместе с закрытым | `deploy/install/docker-compose.install.yml`, `backend/src/main/java/studio/seer/heimdall/lore/AidaLoreResource.java` |
| `FORGEJO_API_TOKEN` | токен моста LORE в Forgejo (статусы CI, PR, мерж); пусто — `/lore/forgejo/*` отвечает 503 | вписывает владелец (Forgejo → Настройки → Приложения) | `.env` 600 | Forgejo install или own | новый токен в Forgejo, значение в `.env`, `up -d`; старый отозвать | `deploy/install/docker-compose.install.yml`, `backend/src/main/java/studio/seer/heimdall/lore/ForgejoBridge.java` |
| `FORGEJO_MCP_TOKEN`, `FORGEJO_TOKEN` | токен forgejo-mcp в Forgejo, отдельный от моста; в контейнер идёт как `FORGEJO_TOKEN` (AIDA/forgejo-mcp, src/config.ts) | вписывает владелец | `.env` 600 | Forgejo install или own | новый токен, `.env`, `up -d forgejo-mcp`; старый отозвать | `deploy/install/docker-compose.install.yml`, `deploy/install/install.sh` |
| `FORGEJO_MCP_API_KEY` | ключ входа агентов в forgejo-mcp (`Authorization: Bearer`); без него HTTP-вход открыт | установщик генерирует при включённом forgejo-mcp | `.env` 600; у агента — в окружении машины, строка MCP ссылается на переменную | Forgejo install или own | новое значение в `.env`, `up -d forgejo-mcp`, обновить окружение агентов | `deploy/install/docker-compose.install.yml`, `deploy/install/install.sh` |
| `LORE_MCP_CLIENT_SECRET` | секрет клиента Keycloak `lore-mcp-full` / `lore-mcp-full_<harness>`: MCP aida-lore получает по нему токен агента. Клиент без настройки окружения шлёт ту же пару в заголовках X-Lore-Client-Id и X-Lore-Client-Secret | окно установщика заводит клиенты в Keycloak и выдаёт секреты | файл `~/kc-clients-<область>.env` 600, затем настройки harness или хранилище | если включён вход через Keycloak | перевыпустить секрет клиента в Keycloak, обновить настройки harness | `mcp-server/src/backend.ts` |
| `LORE_DB_GUARD_AUTH`, `LORE_DB_GUARD_TOKEN_NAMES`, `GUARD_TOKEN_NAMES` | сторож входов ArcadeDB: токен группы db-guard (секрет) и список имён токенов (не секрет) | владелец заводит токен в ArcadeDB | `.env` 600 | только профиль `guard` | новый токен в ArcadeDB, `.env`, `up -d lore-db-guard` | `deploy/install/docker-compose.install.yml`, `deploy/db-guard/guard.mjs` |
| пароль администратора Keycloak | заводить область и клиенты из окна установщика | у владельца Keycloak | нигде: только в запросе к Keycloak, на диск не пишется | новая установка с Keycloak | в Keycloak | — |

Чего в этом профиле нет:

- **Секрета клиента для бэкенда и веба.** Бэкенд проверяет токены как сервис (`quarkus.oidc.application-type=service`). Веб — публичный клиент `lore-app` с PKCE, поэтому `LORE_OIDC_ISSUER` и `LORE_OIDC_CLIENT_ID` — адреса и имена, а не секреты.
- **Infisical.** В установке `lore.secrets.provider=env`, бэкенд читает секреты из окружения контейнера, то есть из `.env`. Хранилище секретов не нужно.
- **`LORE_VOLVA_EMBED_SECRET`** (временная подпись HS256). Профиль его не передаёт. Без пары ES256 встройка Völva отвечает «не настроено».

## Версии и образы

Инсталлятор ставит **только мажорные версии** `vX.Y.0` (решение владелицы 14.11.2026; то же правило, что у публикации на GitHub). Для такой версии образы берутся готовыми из GitHub Container Registry — `ghcr.io/nooriuta/lore-backend:vX.Y.0` и `ghcr.io/nooriuta/lore-web:vX.Y.0`, без входа. Публикует их релизный workflow при мажорном теге — те же образы, что прошли препрод и прод.

```bash
bash deploy/install/install.sh --version v1.18.0            # готовые образы из ghcr
bash deploy/install/install.sh --version v1.18.0 --build    # собрать из исходников тега на месте
```

Патч (`v1.17.21`) и rc — отказ с причиной. Без `--version` инсталлятор собирает из рабочего чекаута (`--src`) — это путь разработки.
