#!/bin/sh
# Приёмка владелицы на ryzenai: интерфейс установщика (Linux-сборка) на 127.0.0.1:2511.
# Новая база — migration_dst_uat на ArcadeDB ryzenai; источник — снимок на препроде (только чтение).
# Файл решений — копия её файла (11 решений); в него пишутся её решения в интерфейсе.
# Файл доступа живёт, пока работает интерфейс; останавливается — удаляется.
B=~/lore-migrate-build; cd $B/clean || exit 1
umask 077
{ cat src.env; echo; echo "MIG_DST_URL=http://127.0.0.1:2490"; echo "MIG_DST_DB=migration_dst_uat"; echo "MIG_DST_USER=root"; echo "MIG_DST_PASSWORD=$(cat $B/arcadedb.secret)"; } > uat.env
rm -f src.env
env -i PATH=/usr/bin:/bin ./lore-migrate connect --env uat.env --create-dst > /dev/null 2>&1
nohup sh -c "env -i PATH=/usr/bin:/bin ./lore-migrate ui --env uat.env --decisions $B/uat-decisions.json --port 2511 > $B/uat-ui.log 2>&1; rm -f $B/clean/uat.env" > /dev/null 2>&1 &
sleep 3; cat $B/uat-ui.log
