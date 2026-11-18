#!/bin/sh
# SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Пробный расчёт ВСЕХ объектов на ryzenai: источник — снимок прода (только чтение),
# в базу ничего не пишется. Отчёт — основа предложения схемы всех типов (propose-schema).
# Файл доступа собирается из migration.env (только ключи источника) + приёмник-копия ryzenai; удаляется в любом исходе.
# Запуск: sh ryzen-dry-all.sh <имя модуля .mjs в clean/>
B=~/lore-migrate-build; cd $B/clean || exit 1
M=${1:?модуль lore-migrate-*.mjs}
trap 'rm -f access.env' EXIT
umask 077
{ grep -E '^(MIG_DB_URL|MIG_SRC_DB|MIG_SRC_USER|MIG_SRC_PASSWORD)=' $B/migration.env; echo "MIG_DST_URL=http://127.0.0.1:2490"; echo "MIG_DST_DB=migration_dst_linux"; echo "MIG_DST_USER=root"; echo "MIG_DST_PASSWORD=$(cat $B/arcadedb.secret)"; } > access.env
N=$B/node-v24.14.1-linux-x64/bin/node
for i in 1 2; do
  env -i PATH=/usr/bin:/bin $N $M dry-run --env access.env --decisions $B/decisions.lore.json --out dry-all-$i.json > dry-all-$i.txt 2>&1
  echo "dry-run #$i exit=$?"; grep -E "отпечаток|не привелось|ошибка" dry-all-$i.txt | head -5 | cut -c1-300
done
cmp -s dry-all-1.json dry-all-2.json && echo "два прогона: отчёты одинаковые" || echo "два прогона: отчёты РАЗНЫЕ"
