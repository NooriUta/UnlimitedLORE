# Инфраструктура и артефакты LORE — сверка 27.11.2026

Сессия LORE (3f1ccb23). Задание владелицы: снять инфраструктурные блокеры, привести серверы, ранбуки и спеки в порядок, проставить им актуальный статус, разработкой не заниматься.

## Коротко

- **Серверы.** ci-server, lore-host, ryzenai и midgard-host живы. Упавших прод-контейнеров нет. Прод LORE — f7f9e496 (v1.19.3).
- **VPN xray на 131 починен.** Из 6 узлов подписки жив один. Генератор брал первый узел, а тот мёртв; скрипт проверки печатал ложное «OK».
- **Ранбуки.** Сверены 18, обновлены 17 (шапка «Статус сверки 27.11» сверху, авторский текст не тронут). Один ранбук уже переписала сессия miniLORE.
- **Спеки.** Сверены 4. [[spec:SPEC-INFRA-CORE-HOST]] переведена в accepted: переезд ядра на lore-host выполнен.
- **Блокеры.** Найдено 19 задач, которые держит инфраструктура. Блок снят у 3: перевёл их в READY FOR DEPLOY до того, как прозвучало «не трогаем задачи». Остальные ждут твоего слова или входа.
- **Odal уже открыт снаружи** (DNS → 91.235.246.118, сайт отвечает 200, стоит noindex).

## Серверы (SSH, 27.11)

| хост | состояние | заметки |
|---|---|---|
| ci-server .131 | 2 дня после перезагрузки, диск 71%, 49 контейнеров, unhealthy нет | CoreDNS поднят CICD 27.11 (лежал 43 ч); мосты kc/inf/lore4400-forward живы; остановленные копии KC/Infisical |
| lore-host .143 | 2 дня, диск 18% | KC 26.6.3, Infisical v0.167.10, LORE f7f9e496 (healthy), minilore-srv 0.6.3, LORE-ygg 26.11.1 |
| ryzenai .150 | 19 ч, диск 51%, ROCm видит GPU | 3 тестовые установки LORE (lore1187, lore-e182, lorefinal); упавшие fj-rehearsal-*; эмбеддер Qwen3-Embedding-**0.6B** на :8088 |
| midgard-host .152 | 2 дня, диск 15% | midgard-arcadedb |

## VPN xray (ci-server) — починен

- **Причина:** из 6 узлов подписки TCP открыт только у 194.55.244.117:8447 (ws+tls). `gen-xray-config.py` всегда брал первый узел (64.176.75.156, закрыт) и умел только REALITY.
- **Правка:**
  - генератор берёт первый живой узел и умеет VLESS+TLS/ws;
  - `refresh-vpn.sh` проверяет 302/200, а не «не 000». Раньше получалось «000000», и проверка проходила.
- **Проверка:** telegram 302, github 200, прямой выход — 91.235.246.118. Бэкапы: `*.bak-20261127-114951`.

## Ранбуки

| ранбук | вердикт |
|---|---|
| RUNBOOK-ARCADEDB-UPGRADE | исторический (сейчас 26.11.1) |
| RUNBOOK-NEXUS-PROXY-RECOVERY | заменён RUNBOOK-CI-MIRROR-KKREPO-NEXUS |
| RUNBOOK-CI-MIRROR-KKREPO-NEXUS | актуален |
| RUNBOOK-CORE-KC-INFISICAL-LOREHOST | актуален |
| RUNBOOK-INFISICAL-IF02-IF03 | исторический (YC выведен) |
| RUNBOOK-INFISICAL-LOCAL-SETUP | исторический |
| RUNBOOK-PROD-SSH-ACCESS | устарел (прод — lore-host) |
| RUNBOOK-SECRETS-HASHICORP-VAULT | справочный (Vault не развёрнут) |
| RUNBOOK-SECRETS-TO-VAULT | частично устарел |
| RUNBOOK-LOCAL-DNS | частично устарел (upstream Quad9, нет ~12 имён, опечатка heimdallr) |
| RUNBOOK-REGRU-DNS-MGMT | актуален |
| RUNBOOK-TRAEFIK-NEW-SERVICE | частично устарел (нет пути dynamic/*-lorehost.yml) |
| RUNBOOK-VPN-XRAY-REFRESH | актуален, VPN починен 27.11 |
| RUNBOOK-MINILORE-AFTER-CISERVER-REBOOT | переписан сессией miniLORE 27.11, шапку не ставил |
| RUNBOOK-DOOD-CI-PITFALLS | актуален |
| RUNBOOK-AUTH-OMILORE | частично устарел (KC на lore-host, 9 профилей) |
| RUNBOOK-LORE-TWO-APPS | частично устарел (v2 и lore-host — сделано) |
| RUNBOOK-DEPLOY-LOCAL-DEV | частично устарел (ArcadeDB 26.11.1) |

## Спеки

| спека | было | стало |
|---|---|---|
| [[spec:SPEC-INFRA-CORE-HOST]] | proposed 0.1.1 | **accepted** 0.1.2 — реализовано; хвост: мосты и копии на 131 |
| [[spec:SPEC-INFRA-ADDRESS-BY-NAME]] | accepted 1.0.0 | accepted 1.0.1 — мостов три (+lore4400-forward) |
| [[spec:SPEC-INFRA-NET-001]] | proposed 1.4.1 | proposed 1.4.2 — частично устарела, нужна редакция 1.5 |
| [[spec:SPEC-SECRETS-001]] | proposed 1.2.0 | proposed 1.2.1 — правила действуют; accepted — твоё решение |

## Блокеры инфраструктуры

Блок снят (переведены в READY FOR DEPLOY с доказательством):

- [[task:SPRINT_LORE_OWN_HOST/OH-MIDGARD-RUNNER]] — deploy-152 прошёл успешно 21.11.
- [[task:SPRINT_BOKVIT_FOUNDATION/BF-REPO]] — репозиторий AIDA/BOKVIT существует с 06.11.
- [[task:SPRINT_ODIN_VEC_ARCH/OV-1]] — узел ryzenai жив; эмбеддер 0.6B вместо плановой 8B.

Ждут тебя (подробно — в графе who-blocks-whom-2026-11-27.html):

- ключи ES256 — [[task:SPRINT_VIZ_EMBED/EMB-L6]];
- права в Infisical — [[task:SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-ADD-INFISICAL]];
- секреты 5 профилей MCP — [[task:SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH]];
- окно MinIO — [[task:SPRINT_LORE_OWN_HOST/OH-S3-REPLACE-MINIO]];
- вход MIDGARD — [[task:SPRINT_LORE_OWN_HOST/OH-MIDGARD-AUTH-CHOICE]];
- удаления — [[task:SPRINT_LORE_OWN_HOST/OH-MIDGARD-RYZENAI-CLEANUP]];
- учётки KC — [[task:SPRINT_LORE_PROJECT_SCOPE/AL-105]];
- гейты — [[task:SPRINT_LORE_OWN_HOST/OH-QG-ACCESS]] (ещё ждёт мой текст спеки issuer v0.3; стоит по стопу на разработку).

## Völva и odal снаружи

- Völva закрыта намеренно: маршрут стоит за фильтром lan-strict (LAN + Headscale), а в DNS у volva.odal записан LAN-адрес. С телефона она открывается только через VPN Headscale.
- Odal (сайт) **уже открыт снаружи**. В reg.ru запись odal A 91.235.246.118, публичный DoH отдаёт тот же адрес, через публичный IP сайт отвечает 200. Казалось, что не открыт, потому что запросы по :53 из домашней сети перехватываются и возвращают 192.168.3.131. Сайт стоит под noindex: снимать — по твоему слову, PR сессии сайта.

## Найдено попутно

- В реестре проектов репозиторий AIDA/seidr-site числится хостом AIDA/core-services, а [[decision:D-2026-LORE-PRODUCT-PROJECT-ROLE]] относит сайт к другому проекту. Записи сайта разбросаны по трём местам. Слаг NooriUta/seidr-site притягивает чужие спринты SPRINT_ALT_*.
- aida-root: 9 спек HOUND/LOOM — пустые оболочки (одна восстановлена), тексты лежат в git.
- Infisical открыт по http на 131:18080 (socat) и 143:18080.
- Архив miniLORE считает возраст записей по дате приёма, а не по времени реплики.
