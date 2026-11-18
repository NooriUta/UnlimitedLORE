#!/bin/sh
# Linux-сборка: наборы решений A и B, каждый в свою новую базу. Файл доступа собирается и удаляется здесь.
B=~/lore-migrate-build; cd $B/clean || exit 1
trap 'rm -f access.env src.env' EXIT; umask 077
R="env -i PATH=/usr/bin:/bin ./lore-migrate"
for S in A B; do
  { cat src.env; echo; echo "MIG_DST_URL=http://127.0.0.1:2490"; echo "MIG_DST_DB=migration_dst_linux_$S"; echo "MIG_DST_USER=root"; echo "MIG_DST_PASSWORD=$(cat $B/arcadedb.secret)"; } > access.env
  $R connect --env access.env --create-dst > /dev/null 2>&1
  $R statuses --env access.env --decisions $B/decisions-$S.json 2>&1 | grep -E "отпечаток|ГОТОВО|СТОП" | sed "s/^/linux $S statuses: /"
  $R transfer --env access.env --decisions $B/decisions-$S.json --reset > tr-$S.txt 2>&1; echo "linux $S transfer exit=$?"
  $R edges --env access.env > ed-$S.txt 2>&1; echo "linux $S edges exit=$? $(tail -1 ed-$S.txt)"
  $R dst-fingerprint --env access.env --out fp-$S.json 2>&1 | tail -1 | sed "s/^/linux $S /"
done
