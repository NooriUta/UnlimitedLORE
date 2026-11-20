#!/bin/sh
# SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Полный перенос ВСЕХ объектов на ryzenai: источник — снимок прода (только чтение),
# приёмник — пробная база на ArcadeDB ryzenai (127.0.0.1:2490), по умолчанию migration_dst_linux.
# Файл доступа собирается из migration.env (ключи источника) + приёмник; удаляется в любом исходе.
# Запуск: sh ryzen-full-all.sh <модуль lore-migrate-*.mjs в clean/> [база приёмника] [метка прогона]
B=~/lore-migrate-build; cd $B/clean || exit 1
M=${1:?модуль lore-migrate-*.mjs}; DST=${2:-migration_dst_linux}; TAG=${3:-run}
SRC=${SRC:-}  # источник: переменная окружения SRC, иначе MIG_SRC_DB из migration.env
trap 'rm -f access.env' EXIT
umask 077
{ grep -E '^(MIG_DB_URL|MIG_SRC_USER|MIG_SRC_PASSWORD)=' $B/migration.env; if [ -n "$SRC" ]; then echo "MIG_SRC_DB=$SRC"; else grep -E '^MIG_SRC_DB=' $B/migration.env; fi; echo "MIG_DST_URL=http://127.0.0.1:2490"; echo "MIG_DST_DB=$DST"; echo "MIG_DST_USER=root"; echo "MIG_DST_PASSWORD=$(cat $B/arcadedb.secret)"; } > access.env
R="env -i PATH=/usr/bin:/bin $B/node-v24.14.1-linux-x64/bin/node $M"
# замер: секунды на шаг (владелица 18.11: «замеряй производительность, оптимизируй работу с базой»)
T0=$(date +%s); t() { N=$(date +%s); echo "  время: $((N-T0)) с"; T0=$N; }
$R connect --env access.env --create-dst > $TAG-connect.txt 2>&1; echo "connect exit=$?"; t
$R transfer --env access.env --decisions ${DEC:-$B/decisions.lore.json} --reset --out $TAG-transfer.json > $TAG-transfer.txt 2>&1; echo "transfer exit=$?"; t; grep -E "^[0-9] |ошибка|Error" $TAG-transfer.txt | cut -c1-400
$R edges --env access.env --decisions ${DEC:-$B/decisions.lore.json} --out $TAG-edges.json > $TAG-edges.txt 2>&1; echo "edges exit=$?"; t; grep -E "сверка|не перенесены|ошибка|Error|вне карты" $TAG-edges.txt | cut -c1-400
$R dst-fingerprint --env access.env --out $TAG-dstfp.json > $TAG-dstfp.txt 2>&1; echo "dst-fingerprint exit=$?"; t; tail -2 $TAG-dstfp.txt | cut -c1-300
