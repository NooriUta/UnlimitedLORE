#!/bin/sh
# Повторный перенос из исходников (после переделки сценариев в функции): тот же отпечаток — значит поведение прежнее.
cd C:/AIDA/UnlimitedLORE/.claude/worktrees/mig/scripts/model-migration || exit 1
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L 2490:127.0.0.1:2490 ryzenai &
T=$!; trap 'kill $T 2>/dev/null' EXIT; sleep 4
E=C:/AIDA/_audit_scripts/mig/win-ryzen.env; D=rules/decisions.lore.json
node cli.mjs transfer --env $E --decisions $D --reset > C:/AIDA/_audit_scripts/mig/w2-transfer.txt 2>&1; echo "transfer exit=$?"; tail -2 C:/AIDA/_audit_scripts/mig/w2-transfer.txt | cut -c1-200
node cli.mjs edges --env $E --decisions $D > C:/AIDA/_audit_scripts/mig/w2-edges.txt 2>&1; echo "edges exit=$?"; tail -1 C:/AIDA/_audit_scripts/mig/w2-edges.txt
node cli.mjs dst-fingerprint --env $E | tail -1
