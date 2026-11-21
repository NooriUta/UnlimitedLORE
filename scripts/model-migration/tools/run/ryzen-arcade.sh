#!/bin/sh
# Отдельный сервер ArcadeDB 26.11.1 для приёмки переноса на ryzenai: свой каталог, свой порт 2490, только 127.0.0.1.
# Чужой сервер на 2480 (midgard) не трогаем. Пароль root генерируется здесь и хранится в файле 600; не печатается.
set -e
B=~/lore-migrate-build
cd $B
if [ ! -d arcadedb ]; then
  mkdir arcadedb && tar -xzf ~/work/tools/dl/arcadedb-26.11.1-base.tar.gz -C arcadedb --strip-components=1
fi
[ -f arcadedb.secret ] || { umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24 > arcadedb.secret; }
chmod 600 arcadedb.secret
if ss -ltn | grep -q '127.0.0.1\]*:2490'; then echo "уже запущен"; exit 0; fi
mkdir -p $B/arcadedb-data
JAVA=~/work/tools/jdk21/bin/java
# Пароль строкой запуска — только при первом старте (виден в списке процессов, найдено 16.11.2026);
# дальше root берётся из config/server-users.jsonl (там хэш).
ROOTPW=""
[ -f $B/arcadedb/config/server-users.jsonl ] || ROOTPW="-Darcadedb.server.rootPassword=$(cat arcadedb.secret)"
nohup $JAVA -server -Xmx8g \
  -Darcadedb.server.rootPath=$B/arcadedb \
  -Darcadedb.server.databaseDirectory=$B/arcadedb-data \
  -Darcadedb.server.httpIncomingHost=127.0.0.1 \
  -Darcadedb.server.httpIncomingPort=2490 \
  $ROOTPW \
  -Darcadedb.server.plugins= \
  -cp "$B/arcadedb/lib/*" com.arcadedb.server.ArcadeDBServer > $B/arcadedb.log 2>&1 &
echo $! > $B/arcadedb.pid
for i in $(seq 1 40); do sleep 1; if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:2490/api/v1/ready | grep -q 204; then echo "запущен, pid $(cat $B/arcadedb.pid)"; exit 0; fi; done
echo "не поднялся"; tail -20 $B/arcadedb.log; exit 1
