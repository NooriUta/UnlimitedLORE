# Установка LORE на Linux

Самодостаточная установка LORE на чистую машину: своя ArcadeDB, бэкенд, веб-интерфейс v2 и MinIO для вложений. От нашей инфраструктуры (Keycloak, Infisical, Forgejo, Traefik) не зависит.

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

## Версии и образы

Инсталлятор ставит **только мажорные версии** `vX.Y.0` (решение владелицы 14.11.2026; то же правило, что у публикации на GitHub). Для такой версии образы берутся готовыми из GitHub Container Registry — `ghcr.io/nooriuta/lore-backend:vX.Y.0` и `ghcr.io/nooriuta/lore-web:vX.Y.0`, без входа. Публикует их релизный workflow при мажорном теге — те же образы, что прошли препрод и прод.

```bash
bash deploy/install/install.sh --version v1.18.0            # готовые образы из ghcr
bash deploy/install/install.sh --version v1.18.0 --build    # собрать из исходников тега на месте
```

Патч (`v1.17.21`) и rc — отказ с причиной. Без `--version` инсталлятор собирает из рабочего чекаута (`--src`) — это путь разработки.
