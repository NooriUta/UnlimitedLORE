#!/usr/bin/env bash
# Ворота препрода — SPRINT_LORE_PIPELINE_HOST/PL-04 (ADR-LORE-046).
#
# Стоят в lore-cd.yml ДО любых сборок и выкаток. Каждая проверка закрывает
# способ, которым препрод мог бы молча задеть прод или подняться «зелёным»
# на чужих данных:
#
#   1. guards  — LORE_DB, окружение Infisical и compose-проект — препродные.
#                system_aida_lore, *_frozen_*, environment=prod и проект
#                unlimitedlore — красный: это значения ПРОДА (или замороженных
#                копий 07.11, брать их нельзя).
#   2. compose — оверлей препрода собирается (`docker compose config`), порты
#                свои: :4400/:9100/:9000 на 131 держат пересыльщик прод-MCP,
#                бэкенд и MinIO 131. Заодно проверка, что `!override` понят
#                этой версией Compose (нужна ≥ 2.24).
#   3. db      — база препрода существует на LORE-ygg 131. Её нет — красный с
#                подсказкой: снимок прода заливает preprod-db-refresh (ручной
#                запуск с подтверждением). Создавать пустую базу молча нельзя:
#                бэкенд накатил бы схему на пустоту, и препрод «работал» бы.
#   4. infisical — окружение preprod в проекте Infisical не пустое. Пустое или
#                несуществующее — красный, БЕЗ отката на prod: делить секреты
#                с продом препрод не должен (решение PL-04, п.5).
#
# DRY_RUN=true — все проверки выполняются и печатаются, отказы идут ::error::,
# но шаг завершается 0 с итогом «боевой прогон упал бы на …»: dry-run должен
# показать ВСЕ проблемы разом, а не первую.
#
# PREPROD_GATES_ONLY=guards — только п.1 (для тестов: без docker и сети).
set -uo pipefail

FAILS=()
fail() { echo "::error::$1"; FAILS+=("$1"); }
ok()   { echo "ok: $1"; }

# ── 1. guards ────────────────────────────────────────────────────────────────
db="${LORE_DB:-}"
case "$db" in
  "")                      fail "LORE_DB не задан — база препрода обязана быть явной" ;;
  system_aida_lore)        fail "LORE_DB=system_aida_lore — это база ПРОДА; препрод работает только на своей копии" ;;
  *_frozen_*)              fail "LORE_DB=$db — замороженная копия 07.11, брать её нельзя (PL-04)" ;;
  *_preprod)               ok "база препрода: $db" ;;
  *)                       fail "LORE_DB=$db — имя базы препрода обязано оканчиваться на _preprod" ;;
esac
envn="${LORE_SECRETS_ENVIRONMENT:-}"
case "$envn" in
  ""|prod|production)      fail "LORE_SECRETS_ENVIRONMENT=${envn:-<пусто>} — препрод не делит секреты с продом, нужно окружение preprod" ;;
  *)                       ok "окружение Infisical: $envn" ;;
esac
proj="${COMPOSE_PROJECT_NAME:-}"
case "$proj" in
  ""|unlimitedlore)        fail "COMPOSE_PROJECT_NAME=${proj:-<пусто>} — это проект старого стенда/прода; препрод — отдельный проект" ;;
  *)                       ok "compose-проект: $proj" ;;
esac

finish() {
  if [ "${#FAILS[@]}" -eq 0 ]; then echo "ворота препрода пройдены"; exit 0; fi
  if [ "${DRY_RUN:-false}" = "true" ]; then
    echo "::warning::dry-run: боевой прогон упал бы на ${#FAILS[@]} проверк(ах/е) ворот препрода (список выше)"
    exit 0
  fi
  echo "ворота препрода НЕ пройдены (${#FAILS[@]}) — выкатка остановлена до сборок"
  exit 1
}

[ "${PREPROD_GATES_ONLY:-}" = "guards" ] && finish

# ── 2. compose ───────────────────────────────────────────────────────────────
docker compose version 2>&1 | head -1
if ! cfg="$(docker compose config 2>&1)"; then
  fail "docker compose config не собрался: $(printf '%s' "$cfg" | tail -5 | tr '\n' ' ')"
else
  # published-порты всех сервисов: в препроде не должно быть 4400, 9100, 9000, 9001, 4402
  pubs="$(docker compose config --format json 2>/dev/null \
    | tr -d ' \n' | grep -oE '"published":"?[0-9]+' | grep -oE '[0-9]+$' | sort -u | tr '\n' ' ')"
  echo "опубликованные порты препрода: ${pubs:-<не прочитаны>}"
  if [ -z "$pubs" ]; then
    fail "порты препрода не прочитаны из compose config — проверка «не занять прод-порты» не выполнилась"
  else
    for p in 4400 4402 9100 9000 9001; do
      case " $pubs " in *" $p "*) fail "препрод публикует :$p — порт старого стенда/прода (оверлей без !override?)" ;; esac
    done
    for p in 4410 4412 9110 19000 19001; do
      case " $pubs " in *" $p "*) ;; *) fail "препрод не публикует :$p — оверлей препрода не применился" ;; esac
    done
  fi
  printf '%s' "$cfg" | grep -qE 'Host\(`(lore|new\.lore)\.odal' \
    && fail "в итоговом compose есть метка Traefik на прод-имя (lore.odal/new.lore)"
  printf '%s' "$cfg" | grep -q "lore.db=$db\|lore.db: $db" \
    && ok "бэкенд получит lore.db=$db" \
    || fail "в итоговом compose бэкенд не получает lore.db=$db"
fi

# ── 3. db ────────────────────────────────────────────────────────────────────
# Адрес ArcadeDB 131 — шлюз сети джоба (как в шаге лечения индексов lore-cd.yml):
# 127.0.0.1 внутри контейнера задания — сам контейнер.
GW="${ARCADE_HOST:-}"
if [ -z "$GW" ]; then
  hex=$(awk '$2=="00000000" && $8=="00000000" {print $3; exit}' /proc/net/route 2>/dev/null)
  if [ -n "$hex" ] && [ ${#hex} -eq 8 ]; then
    GW="$((16#${hex:6:2})).$((16#${hex:4:2})).$((16#${hex:2:2})).$((16#${hex:0:2}))"
  fi
fi
if [ -z "$GW" ]; then
  fail "адрес ArcadeDB не определён — наличие базы $db не проверено"
elif ! dbs="$(curl -sf -m 10 -u "root:${ARCADEDB_ROOT_PASSWORD:-}" "http://$GW:2480/api/v1/databases" 2>&1)"; then
  fail "ArcadeDB http://$GW:2480 не ответил под root — наличие базы $db не проверено"
else
  if printf '%s' "$dbs" | grep -q "\"$db\""; then
    ok "база $db есть на LORE-ygg 131"
  else
    fail "базы $db на LORE-ygg 131 нет. Залейте снимок прода: workflow «LORE preprod DB refresh» (ручной запуск, confirm=$db). Пустую базу CD не создаёт намеренно."
  fi
fi

# ── 4. infisical ─────────────────────────────────────────────────────────────
# Тем же путём, что бэкенд: имя infisical → host-gateway → inf-forward :18080.
INF="${LORE_SECRETS_URL:-http://infisical:18080}"
icurl() { docker run --rm --add-host infisical:host-gateway curlimages/curl:latest -s -m 15 "$@"; }
if [ -z "${LORE_SECRETS_CLIENT_ID:-}" ] || [ -z "${LORE_SECRETS_CLIENT_SECRET:-}" ] || [ -z "${LORE_SECRETS_PROJECT_ID:-}" ]; then
  fail "учётка Infisical не задана — окружение $envn не проверено"
else
  login="$(icurl -X POST -H 'Content-Type: application/json' \
    -d "{\"clientId\":\"${LORE_SECRETS_CLIENT_ID}\",\"clientSecret\":\"${LORE_SECRETS_CLIENT_SECRET}\"}" \
    "$INF/api/v1/auth/universal-auth/login" 2>/dev/null)"
  tok="$(printf '%s' "$login" | tr -d '\n' | sed -n 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -z "$tok" ]; then
    fail "вход в Infisical ($INF) не удался — окружение $envn не проверено: $(printf '%s' "$login" | head -c 200)"
  else
    lst="$(icurl -w '\n%{http_code}' -H "Authorization: Bearer $tok" \
      "$INF/api/v3/secrets/raw?workspaceId=${LORE_SECRETS_PROJECT_ID}&environment=${envn}&secretPath=${LORE_SECRETS_SCOPE:-/}" 2>/dev/null)"
    code="$(printf '%s' "$lst" | tail -n1)"
    body="$(printf '%s' "$lst" | sed '$d')"
    keys="$(printf '%s' "$body" | grep -oE '"secretKey"[[:space:]]*:[[:space:]]*"[^"]+"' | sed -E 's/.*"([^"]+)"$/\1/' | sort -u | tr '\n' ' ')"
    if [ "$code" != "200" ]; then
      fail "окружения $envn в Infisical нет или оно недоступно (HTTP $code): $(printf '%s' "$body" | head -c 200). Отката на prod нет: создайте окружение $envn в проекте и положите туда секреты препрода."
    elif [ -z "$keys" ]; then
      fail "окружение $envn в Infisical ПУСТОЕ — отката на prod нет. Положите секреты препрода (KC_ADMIN_CLIENT_SECRET, FORGEJO_API_TOKEN, …) в окружение $envn."
    else
      echo "ключи окружения $envn (только имена): $keys"
      for k in KC_ADMIN_CLIENT_SECRET FORGEJO_API_TOKEN; do
        case " $keys " in *" $k "*) ;; *) fail "в окружении $envn нет $k — мост не поднимется (шаг DBR-18 упадёт уже после выкатки)" ;; esac
      done
    fi
  fi
fi

finish
