#!/bin/sh
# Пересборка Linux-файла установщика на ryzenai из присланного модуля.
set -e
cd ~/lore-migrate-build/kit
N=~/lore-migrate-build/node-v24.14.1-linux-x64/bin/node
$N --experimental-sea-config sea-config.json >/dev/null
cp $N lore-migrate
$N node_modules/postject/dist/cli.js lore-migrate NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null 2>&1
chmod 755 lore-migrate
cp lore-migrate ~/lore-migrate-build/clean/
echo "собран: $(~/lore-migrate-build/clean/lore-migrate --version)"
