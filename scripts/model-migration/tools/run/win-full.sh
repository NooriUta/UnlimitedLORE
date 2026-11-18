#!/bin/sh
# Полный перенос Windows-сборкой: новая база migration_dst_win на ArcadeDB ryzenai через туннель SSH.
cd C:/AIDA/_audit_scripts/mig/installer-exe || exit 1
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L 2490:127.0.0.1:2490 ryzenai &
T=$!; trap 'kill $T 2>/dev/null' EXIT; sleep 4
E=../win-ryzen.env
./lore-migrate.exe connect --env $E --create-dst > w-connect.txt 2>&1; echo "connect exit=$?"; grep -E '"exists"|"created"|отказ' w-connect.txt
./lore-migrate.exe transfer --env $E --decisions C:/AIDA/UnlimitedLORE/.claude/worktrees/mig/scripts/model-migration/rules/decisions.lore.json --out w-transfer.json > w-transfer.txt 2>&1; echo "transfer exit=$?"; tail -4 w-transfer.txt | cut -c1-300
./lore-migrate.exe edges --env $E --out w-edges.json > w-edges.txt 2>&1; echo "edges exit=$?"; tail -3 w-edges.txt | cut -c1-300
./lore-migrate.exe dst-fingerprint --env $E --out w-dstfp.json > w-dstfp.txt 2>&1; echo "dst-fingerprint exit=$?"; cat w-dstfp.txt
