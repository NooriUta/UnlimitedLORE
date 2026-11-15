---
id: SPRINT_LORE_MD_ARCHIVE/MDA-02
type: task
title: "Бэкенд: GET /lore/export/project/{slug} — текущее состояние проекта как набор MD-файлов (zip)"
status: planned
project: "[[NooriUta__UnlimitedLORE/index|NooriUta/UnlimitedLORE]]"
sprint: "[[SPRINT_LORE_MD_ARCHIVE]]"
links:
  - "[[SPRINT_LORE_MD_ARCHIVE/MDA-01]]"
---

# Бэкенд: выгрузка проекта

## Почему

Одна точка сборки нужна, чтобы MCP и UI выгружали одно и то же.

## Сделать

1. Падающие тесты: чужой проект без роли → 403, а не пустой архив; два прогона подряд → одинаковый sha256.
2. Сборщик — чистая функция: строки срезов на входе, карта путь → текст на выходе.
3. В `index.md` — счётчики и предупреждения: «не смогли прочитать» ≠ «пусто».

Зависит от [[SPRINT_LORE_MD_ARCHIVE/MDA-01|task:SPRINT_LORE_MD_ARCHIVE/MDA-01]].
