#!/bin/sh
# Полный перенос Linux-сборкой на ryzenai: источник — снимок на сервере препрода (только чтение),
# новая база migration_dst_linux — на отдельном ArcadeDB ryzenai (127.0.0.1:2490).
# Файл доступа собирается здесь из присланного и удаляется в любом исходе.
B=~/lore-migrate-build; cd $B/clean || exit 1
trap 'rm -f access.env src.env' EXIT
umask 077
{ cat src.env; echo; echo "MIG_DST_URL=http://127.0.0.1:2490"; echo "MIG_DST_DB=migration_dst_linux"; echo "MIG_DST_USER=root"; echo "MIG_DST_PASSWORD=$(cat $B/arcadedb.secret)"; } > access.env
R="env -i PATH=/usr/bin:/bin ./lore-migrate"
$R connect --env access.env --create-dst > connect.txt 2>&1; echo "connect exit=$?"; grep -E '"exists"|"created"|отказ' connect.txt
$R transfer --env access.env --decisions $B/decisions.lore.json --out transfer.json > transfer.txt 2>&1; echo "transfer exit=$?"; tail -4 transfer.txt | cut -c1-300
$R edges --env access.env --decisions $B/decisions.lore.json --out edges.json > edges.txt 2>&1; echo "edges exit=$?"; tail -3 edges.txt | cut -c1-300
$R dst-fingerprint --env access.env --out dstfp.json > dstfp.txt 2>&1; echo "dst-fingerprint exit=$?"; cat dstfp.txt
