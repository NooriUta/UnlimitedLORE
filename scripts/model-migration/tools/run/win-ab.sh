#!/bin/sh
# Windows-сборка: наборы решений A и B, каждый в свою новую базу на ryzenai через туннель.
cd C:/AIDA/_audit_scripts/mig/installer-exe || exit 1
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L 2491:127.0.0.1:2490 ryzenai &
T=$!; trap 'kill $T 2>/dev/null; rm -f ../win-ab.env' EXIT; sleep 4
for S in A B; do
  ( umask 077; { cat ../migration.env; echo; echo "MIG_DST_URL=http://127.0.0.1:2491"; echo "MIG_DST_DB=migration_dst_win_$S"; echo "MIG_DST_USER=root"; grep "^MIG_DST_PASSWORD=" ../win-ryzen.env | tail -1; } > ../win-ab.env )
  ./lore-migrate.exe connect --env ../win-ab.env --create-dst > /dev/null 2>&1
  ./lore-migrate.exe statuses --env ../win-ab.env --decisions ../decisions-$S.json 2>&1 | grep -E "отпечаток|ГОТОВО|СТОП" | sed "s/^/windows $S statuses: /"
  ./lore-migrate.exe transfer --env ../win-ab.env --decisions ../decisions-$S.json --reset > w-tr-$S.txt 2>&1; echo "windows $S transfer exit=$?"
  ./lore-migrate.exe edges --env ../win-ab.env > w-ed-$S.txt 2>&1; echo "windows $S edges exit=$? $(tail -1 w-ed-$S.txt)"
  ./lore-migrate.exe dst-fingerprint --env ../win-ab.env --out w-fp-$S.json 2>&1 | tail -1 | sed "s/^/windows $S /"
done
