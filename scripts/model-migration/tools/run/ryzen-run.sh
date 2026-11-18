#!/bin/sh
# Приёмочный прогон на ryzenai: два раза каждый шаг, печать отпечатков; файл доступа удаляется в любом исходе.
cd ~/lore-migrate-build/clean || exit 1
trap 'rm -f access.env' EXIT
chmod 600 access.env
for i in 1 2; do
  env -i PATH=/usr/bin:/bin ./lore-migrate statuses --env access.env 2>&1 | grep "отпечаток" | sed "s/^/linux statuses #$i /"
  env -i PATH=/usr/bin:/bin ./lore-migrate dry-run --env access.env 2>&1 | grep "отпечаток" | sed "s/^/linux dry-run  #$i /"
done
