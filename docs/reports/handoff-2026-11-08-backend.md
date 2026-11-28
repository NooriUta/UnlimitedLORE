# Передача 08.11.2026 — бэкенд, труба, инфраструктура (НЕ kit, НЕ контракты паспорта)

Ты — сессия бэкенда/трубы LORE в клоне `UnlimitedLORE` (Forgejo `AIDA/UnlimitedLORE`, ветки develop → preprod → main+тег). Отчёты — по-русски, ответы на телефон — `minilore-link reply` с цитатой; объекты LORE — кликабельной формой `SPRINT_X/CODE`, без обратных кавычек. Kit/web-next делает отдельная сессия kit. Контракты паспорта `lore.record/1` (ADR-LORE-047) — PR #919: проверь, влит ли он и вышел ли v1.17.3.

## Где стоим (факты на 08.11, вечер)

- Прод LORE на lore-host (192.168.3.143): **v1.17.2** (тег на main bd91b1af, образы a2dc70bc, бандл v2 `index-CdxvxUlz.js`, схема v70). Релизы v1.17.0 / v1.17.1 / v1.17.2 выкачены новой трубой и оформлены в LORE (спринты и PR привязаны).
- Труба (ADR-LORE-046) работает: push в preprod → LORE CD собирает и катит препрод на ci-server (`lore-preprod`, база `system_aida_lore_preprod`, порты 4410/4412/9110) и метит образы `:sha8`; тег `v*` на main → `lore-release.yml` везёт ТЕ ЖЕ образы на lore-host (бэкап compose и базы, накатка схемы, пробы бандлов и `/lore/version`). Ручной dry-run: dispatch с `tag` + `dry_run=true`.
- Препрод: бэкенд ходит в ArcadeDB 131 под root (решение владелицы «это препрод»). Имена `preprod.*` только во внутреннем DNS — владелица: «препрод доделаем через неделю, по этим адресам пока не открывать».
- Gradle-дистрибутив в сборке образа — из постоянного cache mount BuildKit на 131 (`id=lore-gradle-wrapper-dists`); `--no-cache` его отключает. Nexus gradle-dist-proxy НЕ заведён — пароль admin Nexus потерян.
- Данные: у 65 старых спринтов `status_raw` нормализован в «✅ DONE» напрямую (бэкапы `system_aida_lore-backup-20261108-132953149.zip` на lore-host). Задачи с тем же разбросом статусов НЕ проверялись.
- Git: 313 смерженных веток удалены, на origin 21 ветка (см. ниже). Открытых PR нет, кроме будущего PR контрактов.

## Что доделать (по приоритету)

1. **SPRINT_LORE_PIPELINE_HOST/PL-12** — Nexus gradle-dist-proxy: после восстановления пароля admin Nexus (владелица/соседка CICDGitHub) завести raw-proxy `gradle-dist-proxy` → `https://services.gradle.org/distributions/`. Код уже ждёт (Dockerfile.local ARG `LORE_GRADLE_DIST_MIRROR`, проба в `compose-build-retry.sh`). Проверка: лог сборки «зеркало дистрибутива Gradle отвечает». Потом PL-12 → done.
2. **SPRINT_LORE_PIPELINE_HOST/PL-10** — свой пользователь ArcadeDB для препрода только на `system_aida_lore_preprod` (сейчас root; на 131 живёт midgard_datahub). Учётку заводит владелица (пароли агент не вводит); в `lore-cd.yml` вернуть токен вместо `LORE_MART_AUTH: basic`.
3. **SPRINT_LORE_MEASURE_TRUTH/MT-CI-STATUS-NULL** — `forgejo_ci_status` на SHA без статусов падает «statuses is null» → честный NO_CHECKS. Тест до правки.
4. **SPRINT_LORE_PIPELINE_HOST/PL-06** — CLAUDE.md проекта и панель «Правила CLAUDE»: описать новый поток (develop → preprod на 131 → main+тег на lore-host, dry-run, откат по `docker-compose.yml.bak-<тег>`). CLAUDE.md проекта — только локально + `doc_new claude_rules_unlimitedlore`.
5. **SPRINT_LORE_PIPELINE_HOST/PL-02, PL-03** — бэкенд-CI на две джобы (сервер / накат схемы) и шаблон «пустая база версии N».
6. **Нормализация статусов ЗАДАЧ** (как у спринтов): найти `status_raw` задач вне словаря `shared/lore-statuses.json` (маркер/слово в начале), показать владелице список, по её «да» — сначала препрод (бэкап → UPDATE → сверка), потом прод, даты версий не трогать.
7. **SPRINT_UXR_S2_GRAPH_MEMORY/S2-11** (гигиена истории) и **S2-14** (`release_link rel=pr` не заполняет title/url/merged_at у PR).
8. **SPRINT_UXR_S7A_NEWS** — S7A-01 и S7A-09 partial, S7A-08 (паритет ленты), S7A-10/11 (приёмки), S7A-12 («Новости» перегружены).
9. **SPRINT_UXR_S3_V2_INFRA** — S3-07 (флаг навигации v1↔v2, partial), S3-11 (очередь промо-PR при ёмкости раннера 2), S3-14 (Telegram из CD молчит). S3-12 — PR #868 закрыт как устаревший (v2 уже на lore-host) → поставить задаче cancelled с этой причиной.
10. **SPRINT_UXR_S11_TEST_OPT/CI-05** — 8,4 ГиБ swap на ci-server.
11. **Ветки на origin** (не влиты, разобрать с владелицей — удалить или довести): `chore/lore-host-compose`, `feature/pl-02-backend-ci-schema-split`, `feature/s2-08-portable-route` (PR #871 закрыт), `feature/s2-11-14`, `feature/srch11-cleanup-release`, `fix/cd-lore-host-ssh-probe`, `fix/drop-unused-nivo`, `fix/s312-v2-canonical-host` (PR #868 закрыт), `fix/tg-notifications` (PR #231 закрыт), `probe/arcadedb-26-11-1`, `probe/dbu-17-unionall-two-types`, `probe/dbu-19-arcadedb-26101`, `release/v1.7.2`. Ветки kit (`feature/s4-*`) — не твои.
12. **Старые worktree** флотов агентов живут только на СТАРОЙ машине владелицы — на новой их нет, пункт не твой.

## Правила (нарушать нельзя)

- Без её «да» — никаких тегов/релизов в main; промо develop → preprod и мерж в develop по зелёному CI — предавторизованы.
- `./gradlew test` локально НЕ запускать (мигрирует общую схему); доказательство — CI на PR. Gradle — из `backend/`.
- LORE пишем только через MCP; прямые правки прод-базы — только с её явного разрешения, сначала препрод, с бэкапом.
- Пароли и секреты не вводить и не читать; «не трогай мою машину» (hosts/DNS ноутбука).
- Тест до правки, отчёт с дельтой зелёных; «flaky» — только после ≥10 прогонов со счётом.
- Заблокировано — писать громко блоком BLOCKED (что, зачем, как разблокировать).
