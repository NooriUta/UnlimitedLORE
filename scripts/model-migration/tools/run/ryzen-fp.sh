#!/bin/sh
# SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Отпечатки двух пробных баз на ryzenai — сверка воспроизводимости переноса.
# Читает только приёмники. Файл доступа удаляется в любом исходе.
# Запуск: sh ryzen-fp.sh <модуль lore-migrate-*.mjs в clean/> <база A> <база B>
B=~/lore-migrate-build; cd $B/clean || exit 1
M=${1:?модуль}; A=${2:?база A}; C=${3:?база B}
trap 'rm -f access.env' EXIT
umask 077
N=$B/node-v24.14.1-linux-x64/bin/node
for DST in $A $C; do
  { grep -E '^(MIG_DB_URL|MIG_SRC_DB|MIG_SRC_USER|MIG_SRC_PASSWORD)=' $B/migration.env; echo "MIG_DST_URL=http://127.0.0.1:2490"; echo "MIG_DST_DB=$DST"; echo "MIG_DST_USER=root"; echo "MIG_DST_PASSWORD=$(cat $B/arcadedb.secret)"; } > access.env
  env -i PATH=/usr/bin:/bin $N $M dst-fingerprint --env access.env --out fp-$DST.json 2>&1 | tail -1 | sed "s/^/$DST: /"
done
