# Установка LORE на Linux

Самодостаточная установка LORE на чистую машину: своя ArcadeDB, бэкенд и веб-интерфейс v2. Файлы (вложения, аватары, ассеты BRAGI) — своё S3 или без файлов (см. «Хранилище файлов»). От нашей инфраструктуры (Keycloak, Infisical, Forgejo, Traefik) не зависит. Вход через Keycloak, встройка Völva и Forgejo с forgejo-mcp — по выбору (см. ниже).

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

Свои пароли вместо сгенерированных задаются переменной `ARCADEDB_ROOT_PASSWORD`. Посмотреть план без изменений можно флагом `--dry-run`.

Первый старт на пустой базе занимает несколько минут: бэкенд сам поднимает ядро схемы и накатывает все шаги миграций. Флаг `LORE_BOOTSTRAP` не нужен.

## Настройка окружения

Все настройки установки — в одном файле `.env` в каталоге установки (права 600). Образец — `.env.example` пакета. Окно установщика собирает `.env` по вашему выбору кнопкой «Собрать .env», `install.sh` дописывает пароли и версию сам.

Что в нём по группам:

- **Версия и образы** — `LORE_VERSION`, `LORE_SRC` (каталог исходников, заполняет `install.sh`), `LORE_BACKEND_IMAGE` и `LORE_WEB_IMAGE` (готовые образы, тогда сборки нет).
- **База** — `ARCADEDB_VERSION`, `LORE_DB`, `ARCADEDB_ROOT_PASSWORD`.
- **Файлы** — `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (см. «Хранилище файлов»).
- **Сеть** — `LORE_BIND` (по умолчанию `127.0.0.1`), `LORE_HTTP_PORT` (4400), `LORE_PUBLIC_URL` (https-адрес за reverse proxy).
- **Вход** — `LORE_AUTH_ENABLED`, `LORE_OIDC_ISSUER`, `LORE_OIDC_ORIGIN`, `LORE_OIDC_CLIENT_ID` (см. «Keycloak»).
- **Völva** — `LORE_VOLVA_ORIGIN`, `LORE_VOLVA_EMBED_SITE_URL`, `LORE_VOLVA_EMBED_ISSUER` (см. «Völva»).
- **Forgejo** — `COMPOSE_PROFILES`, `FORGEJO_*` (см. «Forgejo и forgejo-mcp»).
- **Локальная LLM** — `LORE_LLM_LOCAL_URL`, `LORE_LLM_LOCAL_MODEL`, `LORE_LLM_LOCAL_API_KEY` (см. «Локальная LLM»).

Пароли в образце — заглушки `CHANGE_ME`: оставленная заглушка значит «сгенерировать». Окно установщика пароли, токены и ключи в `.env` не передаёт — их генерирует `install.sh` или вписывает владелец. Какие секреты есть и как их сменить — раздел «Секреты рантайма».

После ручной правки `.env` — `docker compose up -d` в каталоге установки или повтор `install.sh` в тот же каталог.

## Собрать самому

Если готовые образы недоступны (нет доступа к ghcr, закрытая сеть), LORE собирается из исходников, которые лежат в пакете установщика. Это наш проект на том же коммите, из которого собран пакет.

- В каталоге версии пакета есть `src/lore-<версия>.tar.gz` и рядом `src/lore-<версия>.tar.gz.sha256`. Архив сделан `git archive`; файлов `.env*`, `*.secret`, `*.key` в нём нет.
- Положите каталог `src/` рядом с `install.sh` и запустите:

```bash
bash deploy/install/install.sh --dir /opt/lore --build-from-source
```

- `install.sh` сверяет sha256 архива. При несовпадении или без файла `.sha256` установка останавливается. Затем распаковывает архив в `<каталог установки>/src/<версия>/` и собирает образы бэкенда и веба на месте.
- Версия берётся из имени архива, `--version` с этим флагом не задаётся. Готовые образы (`LORE_BACKEND_IMAGE`, `LORE_WEB_IMAGE`) с этим флагом тоже не задаются — одно из двух.
- Свой архив вместо лежащего рядом — переменная `LORE_SRC_ARCHIVE=<путь к lore-<версия>.tar.gz>`.
- Сборке нужен доступ к Docker Hub, Maven Central и npm, как в разделе «Требования». Первая сборка — 10–20 минут.

Без флага всё как раньше: архив не трогается. В окне установщика это выбор на «Старте»: «готовые образы» или «собрать из исходников пакета».

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
  - `src/<тег>/` — исходники тега (или распакованный архив пакета при `--build-from-source`), из которых собраны образы.
- Контейнеры проекта compose `lore`: `arcadedb`, `lore-backend`, `lore-app-next`.
- Тома: `lore_lore-db` (база), `lore_lore-db-backups` (бэкапы перед миграциями). Файлы — в своём S3, на машине их нет.
- Наружу открыт только веб-интерфейс, по умолчанию на `127.0.0.1:4400`. База и бэкенд портов не публикуют.

## Проверка

Инсталлятор сам проверяет результат в конце. Повторить проверку:

```bash
bash deploy/install/install.sh --dir /opt/lore --verify
```

Проверяются здоровье бэкенда (`/q/health/ready`, `/lore/version`), непустой справочник `dictionary`, продуктовые слайсы `features`, `use_cases_of_feature`, `pains`, `gains`, `jobs`, `actors`, `asset_orphans` и поиск `/lore/search`. Запросы идут через веб-интерфейс, поэтому заодно проверяется его прокси к бэкенду.

## Безопасность

В этом профиле аутентификации нет (`LORE_AUTH_ENABLED=false`): любой, кто достучался до порта, читает и пишет данные. Поэтому порт по умолчанию слушает только localhost. Чтобы открыть LORE в сеть, поставьте перед ним reverse proxy с TLS и авторизацией и задайте `LORE_PUBLIC_URL`. Значение `--bind 0.0.0.0` выставляйте только осознанно.

## Keycloak — вход по выбору

По умолчанию входа нет (`LORE_AUTH_ENABLED=false`, см. «Безопасность»). Вход включается через Keycloak: свой или поставленный по ссылкам из окна установщика.

Наш Keycloak работает на встроенной H2 (dev-file). Для своей установки — внешняя БД (Postgres) и режим start, не start-dev.

Что нужно:

- Keycloak, до которого достают браузер и контейнер бэкенда. Нет своего — на «Старте» выберите «нет — скачать и настроить»: окно даст официальные ссылки и шаги запуска.
- Администратор Keycloak — только для новой установки. Окно спрашивает его логин и пароль, чтобы завести область. Пароль не пишется на диск и не сохраняется.
- Адрес веба LORE (`http(s)://хост[:порт]`, без пути): он становится адресом возврата клиента веба.

Как настроить:

1. В окне впишите «Адрес области Keycloak» (`https://<keycloak>/realms/<область>`) и «Адрес веба LORE».
2. «План области Keycloak» показывает запросы без записи: область, роли `superadmin`, `admin`, `viewer`, клиент веба `lore-app` (публичный, PKCE S256) и клиенты MCP `lore-mcp-full` / `lore-mcp-full_<harness>`. Роли приходят в токене claim-ом `seer_roles`.
3. «Завести область» выполняет план. Уже существующее не трогается, повтор безопасен. Секреты клиентов MCP уходят в файл `~/kc-clients-<область>.env` (права 600), на экран не выводятся.
4. «Собрать .env» включает вход: `LORE_AUTH_ENABLED=true`, `LORE_OIDC_ISSUER`, `LORE_OIDC_ORIGIN`, `LORE_OIDC_CLIENT_ID=lore-app`. Веб берёт их при запуске контейнера, в образ они не впекаются: после смены адреса или клиента достаточно `docker compose up -d`. Включение и выключение входа (`LORE_AUTH_ENABLED`) бэкенд фиксирует при сборке (`quarkus.oidc.enabled`), поэтому смена этого флага — повтор `install.sh`.
5. Первому владельцу выдайте в Keycloak роль `superadmin`.

## Völva — встроенные графики

По выбору. Völva ставится своей поставкой, установщик настраивает только связь: LORE подписывает встройку ключом ES256, Völva проверяет подпись.

Как настроить:

1. На «Старте» отметьте Völva и впишите «Адрес Völva» и «Адрес веба LORE».
2. «Ключи Völva» создаёт пару ES256 и пишет её в файл `volva-embed.env` (права 600). На экране — только открытый ключ.
3. Перенесите обе строки (`LORE_VOLVA_EMBED_ES256_PRIVATE_KEY`, `LORE_VOLVA_EMBED_ES256_PUBLIC_KEY`) в `.env` установки или в своё хранилище и выполните `docker compose up -d`.
4. «Собрать .env» кладёт адреса: `LORE_VOLVA_ORIGIN`, `LORE_VOLVA_EMBED_SITE_URL`, `LORE_VOLVA_EMBED_ISSUER` (издатель — origin веба LORE).
5. На стороне Völva впишите тот же издатель в `MB_EMBEDDING_JWT_ISSUERS`. Ключи Völva берёт с `<адрес веба LORE>/lore/embed/jwks`.

Без адреса веба LORE издатель не задан, и подпись остаётся временной. Проверка — «Проверить связь» в окне: ключ установки должен быть опубликован в `/lore/embed/jwks`.

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

## Локальная LLM: векторный индекс и гейты качества

По выбору. Без модели LORE работает полностью, как раньше. Платные провайдеры (Anthropic и другие) не подключены — только своя модель на своей машине.

### Что даёт каждая часть

| часть | что даёт | в этой версии |
|---|---|---|
| **Гейты качества (QG)** | рутина считает метрики сама, затем модель пишет к ним короткое суждение. На числа модель не влияет: метрики готовы до её вызова | подключение есть. Но ни одна рутина суждения ещё не просит — переменные готовят место |
| **Векторный индекс** | поиск по смыслу, а не по словам: найти похожие задачи и решения до заведения новых, затем соседей по графу (ADR-LORE-057, D-2026-GRAPH-SEARCH-VECTOR-PROBE) | **будет в версии после 1.18.** Кода индекса, эмбеддингов и их настроек в этой версии нет, вписывать нечего |

### Какие модели проверены

- **Эмбеддинги — Qwen3-Embedding, размерность 1024** (проба 19.11.2026). Сервер — `llama-server`, `/v1/embeddings`, только плотный вектор. Индекс — `LSM_VECTOR` в ArcadeDB 26.11.1, создан и опрошен на копии базы. Сходство пар-дублей 0,55–0,71, несвязанных пар — 0,33–0,44. Это проба, а не настройка: в установку эмбеддинги пока не подключаются.
- **Чат для суждений QG — любая модель за OpenAI-совместимым API.** Первый живой прогон (27.08.2026) — Qwen3. У рассуждающих моделей потолок токенов может уйти на размышление, и тогда ответ придёт пустым (`finish_reason=length`). LORE пишет это как «не измерено» с причиной, а не как пустой ответ.

### Как поднять сервер модели

LORE ходит в модель на диалекте OpenAI: `POST <адрес>/v1/chat/completions`. Подходит любой раннер с этим API. Пример с Ollama на той же машине, что и LORE:

```bash
# Ollama: слушать не только localhost, чтобы контейнер бэкенда достучался
OLLAMA_HOST=0.0.0.0:11434 ollama serve &
ollama pull qwen3:4b
curl -s http://127.0.0.1:11434/v1/models     # модель в списке
```

OpenAI-совместимый `llama-server` из llama.cpp — так стоит модель на нашей машине:

```bash
llama-server -m <модель>.gguf --host 0.0.0.0 --port 8086 --alias qwen3-4b
# вектора для будущего индекса — отдельный процесс:
# llama-server -m <Qwen3-Embedding>.gguf --embedding --host 0.0.0.0 --port 8088
```

vLLM (`vllm serve <модель> --port 8000`) и LM Studio (сервер на `:1234`) подключаются так же: нужен адрес и имя модели.

### Какие переменные вписать

В `.env` установки (образец — `.env.example`, окно установщика заполняет их в шаге «LLM»):

| переменная | что | пример |
|---|---|---|
| `LORE_LLM_LOCAL_URL` | адрес сервера модели **без** `/v1`. Модель на той же машине — `host.docker.internal`, пакет пробрасывает это имя в контейнер бэкенда | `http://host.docker.internal:11434`, `http://192.168.3.50:8086` |
| `LORE_LLM_LOCAL_MODEL` | имя модели, как его отдаёт `/v1/models`. Пусто — провайдер отвечает «локальная модель не задана» | `qwen3:4b`, `qwen3-4b` |
| `LORE_LLM_LOCAL_API_KEY` | ключ, только если раннер его требует (`--api-key`). Уходит заголовком `Authorization: Bearer` | пусто |

После правки — `docker compose up -d lore-backend` в каталоге установки.

Что ещё нужно гейтам качества. Это настройки рутины, а не переменные пакета (`backend/src/main/resources/application.properties`, `QgLlmSettings`):

- **Цена.** `lore.llm.price.local.*=0` — уже задана, локальная модель бесплатна.
- **Потолок рутины.** `lore.qg.routines.<имя>.max-tokens` или `max-usd`. Умолчания нет намеренно: без потолка модель не вызывается, флаг прогона `budget: budget_unset`. Когда рутина получит суждение, потолок задаётся переменной окружения бэкенда по правилу MicroProfile Config. Например, `LORE_QG_ROUTINES_QG_SUPERVISOR_MAX_TOKENS=20000`.
- **Модель рутины.** `lore.qg.routines.<имя>.model`. Пусто — `local`.

### Как проверить, что подключилось

1. Сервер модели виден из контейнера бэкенда:
   ```bash
   docker compose exec lore-backend curl -fsS "$LORE_LLM_LOCAL_URL/v1/models"
   ```
   Должен прийти JSON со списком моделей, и `LORE_LLM_LOCAL_MODEL` в нём есть. Ошибка соединения — модель слушает только `127.0.0.1` (Ollama: `OLLAMA_HOST=0.0.0.0`) или закрыт порт.
2. Модель отвечает тем запросом, которым её зовёт LORE:
   ```bash
   docker compose exec lore-backend curl -fsS "$LORE_LLM_LOCAL_URL/v1/chat/completions" \
     -H 'Content-Type: application/json' \
     -d "{\"model\":\"$LORE_LLM_LOCAL_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ok?\"}],\"max_tokens\":64}"
   ```
   В ответе `choices[0].message.content` не пустой. Если пустой, а `finish_reason` = `length` — поднимите `max_tokens`.
3. В самом LORE: в прогоне рутины QG с суждением поле `model` заполнено, а строка суждения — с числом токенов. Отдельной ручки «проверить модель» у бэкенда нет.

### Что будет без модели

- **Поиск «похожих»** (`search_similar`, `/lore/search/similar`) работает на полнотексте ArcadeDB: совпадение слов, а не смысла. Так же работает и с моделью, пока нет векторного индекса.
- **Рутины QG** считают и пишут метрики как обычно. Суждения нет:
  - модель не задана или недоступна — строка суждения «не измерено», причина `source_unreachable`;
  - нет потолка или цены — `budget_exhausted` с флагом `budget_unset` или `price_unknown`;
  - у рутины без аналитика (в этой версии — у всех) модель не вызывается вовсе.

## Хранилище файлов

Своего хранилища пакет не ставит: Docker Hub перестал отдавать образ MinIO (21.11.2026). Выбор — флаг `--files`:

- **`--files none`** (по умолчанию) — без файлов. LORE работает; загрузка и показ вложений, аватаров и ассетов BRAGI отвечают «хранилище файлов не подключено» (503).
- **`--files s3`** — своё S3: адрес, регион, бакет и ключи в окружении или в `.env` (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`). До запуска установщик проверяет связь: кладёт пробный объект и читает его обратно; не вышло — останавливается с причиной.

Бакет один на все файлы: ключи разведены приставками — ассеты LORE `<тип>/<код>/…`, BRAGI `bragi/…`, аватары `user/…`.

## Секреты рантайма

Здесь перечислено всё, что читает работающая установка. Секреты, нужные только для разработки, сюда не входят. Значения нигде не печатаются: инсталлятор пишет их в `.env` (права 600) и на экран не выводит. Колонка «где читается» — файл в этом репозитории, где переменную берёт рантайм. Перечень сверяет тест `scripts/model-migration/installer-forgejo.test.mjs` в обе стороны с compose и `.env.example`.

| секрет | зачем | кто создаёт | где хранится | обязателен | как сменить | где читается |
|---|---|---|---|---|---|---|
| `ARCADEDB_ROOT_PASSWORD` | пароль root ArcadeDB: бэкенд ходит в базу, инсталлятор создаёт базу | установщик генерирует (или ваше значение из окружения) | `.env` 600; внутри тома `lore-db` | всегда | сменить пароль root в ArcadeDB, затем значение в `.env`, `docker compose up -d` | `deploy/install/docker-compose.install.yml`, `backend/src/main/resources/application.properties`, `deploy/install/install.sh` |
| `S3_SECRET_KEY` | секретный ключ своего S3 (файлы) | владелец (`--files s3`) | `.env` 600 | только с `--files s3` | новое значение в `.env` и `docker compose up -d lore-backend` | `deploy/install/docker-compose.install.yml`, `backend/src/main/resources/application.properties` |
| `S3_ACCESS_KEY` | ключ доступа своего S3 — не секрет, но читается рядом с секретным | владелец (`--files s3`) | `.env` | только с `--files s3` | вместе с секретным ключом | `deploy/install/docker-compose.install.yml`, `backend/src/main/resources/application.properties` |
| `LORE_VOLVA_EMBED_ES256_PRIVATE_KEY` | закрытый ключ подписи встройки Völva (ES256, PKCS#8) | окно установщика («Ключи Völva») | файл `volva-embed.env` 600, затем `.env` 600 | если выбрана Völva | новая пара в окне установщика, обе строки в `.env`, `up -d`; Völva перечитает `/lore/embed/jwks` | `deploy/install/docker-compose.install.yml`, `backend/src/main/java/studio/seer/heimdall/lore/AidaLoreResource.java` |
| `LORE_VOLVA_EMBED_ES256_PUBLIC_KEY` | открытый ключ пары, отдаётся в `/lore/embed/jwks`; не секрет | окно установщика, вместе с закрытым | `.env` | если выбрана Völva | вместе с закрытым | `deploy/install/docker-compose.install.yml`, `backend/src/main/java/studio/seer/heimdall/lore/AidaLoreResource.java` |
| `FORGEJO_API_TOKEN` | токен моста LORE в Forgejo (статусы CI, PR, мерж); пусто — `/lore/forgejo/*` отвечает 503 | вписывает владелец (Forgejo → Настройки → Приложения) | `.env` 600 | Forgejo install или own | новый токен в Forgejo, значение в `.env`, `up -d`; старый отозвать | `deploy/install/docker-compose.install.yml`, `backend/src/main/java/studio/seer/heimdall/lore/ForgejoBridge.java` |
| `FORGEJO_MCP_TOKEN`, `FORGEJO_TOKEN` | токен forgejo-mcp в Forgejo, отдельный от моста; в контейнер идёт как `FORGEJO_TOKEN` (AIDA/forgejo-mcp, src/config.ts) | вписывает владелец | `.env` 600 | Forgejo install или own | новый токен, `.env`, `up -d forgejo-mcp`; старый отозвать | `deploy/install/docker-compose.install.yml`, `deploy/install/install.sh` |
| `FORGEJO_MCP_API_KEY` | ключ входа агентов в forgejo-mcp (`Authorization: Bearer`); без него HTTP-вход открыт | установщик генерирует при включённом forgejo-mcp | `.env` 600; у агента — в окружении машины, строка MCP ссылается на переменную | Forgejo install или own | новое значение в `.env`, `up -d forgejo-mcp`, обновить окружение агентов | `deploy/install/docker-compose.install.yml`, `deploy/install/install.sh` |
| `LORE_MCP_CLIENT_SECRET` | секрет клиента Keycloak `lore-mcp-full` / `lore-mcp-full_<harness>`: MCP aida-lore получает по нему токен агента. Клиент без настройки окружения шлёт ту же пару в заголовках X-Lore-Client-Id и X-Lore-Client-Secret | окно установщика заводит клиенты в Keycloak и выдаёт секреты | файл `~/kc-clients-<область>.env` 600, затем настройки harness или хранилище | если включён вход через Keycloak | перевыпустить секрет клиента в Keycloak, обновить настройки harness | `mcp-server/src/backend.ts` |
| `LORE_DB_GUARD_AUTH`, `LORE_DB_GUARD_TOKEN_NAMES`, `GUARD_TOKEN_NAMES` | сторож входов ArcadeDB: токен группы db-guard (секрет) и список имён токенов (не секрет) | владелец заводит токен в ArcadeDB | `.env` 600 | только профиль `guard` | новый токен в ArcadeDB, `.env`, `up -d lore-db-guard` | `deploy/install/docker-compose.install.yml`, `deploy/db-guard/guard.mjs` |
| `LORE_LLM_LOCAL_API_KEY` | ключ сервера локальной модели (заголовок `Authorization: Bearer`); пусто — без заголовка, обычный случай для Ollama | вписывает владелец, если раннер запущен с `--api-key` | `.env` 600 | только если сервер модели требует ключ | новый ключ на сервере модели и в `.env`, `up -d lore-backend` | `deploy/install/docker-compose.install.yml`, `backend/src/main/resources/application.properties` |
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
