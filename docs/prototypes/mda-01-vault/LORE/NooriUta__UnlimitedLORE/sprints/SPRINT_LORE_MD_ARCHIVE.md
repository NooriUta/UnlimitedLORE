---
id: SPRINT_LORE_MD_ARCHIVE
type: sprint
title: "Выгрузка проекта в локальный MD-архив"
status: active
priority: low
project: "[[NooriUta__UnlimitedLORE/index|NooriUta/UnlimitedLORE]]"
components:
  - "[[OMILORE]]"
milestones:
  - "M-LORE-W5-VOLVA"
  - "M-OMILORE-O3"
created: 2026-11-04
---

# Выгрузка проекта в локальный MD-архив

## Задачи

- [[SPRINT_LORE_MD_ARCHIVE/MDA-01|task:SPRINT_LORE_MD_ARCHIVE/MDA-01]] — Состав и раскладка архива
- [[SPRINT_LORE_MD_ARCHIVE/MDA-02|task:SPRINT_LORE_MD_ARCHIVE/MDA-02]] — Бэкенд: выгрузка проекта (zip)
- task:SPRINT_LORE_MD_ARCHIVE/MDA-03 (в образец не выгружена)
- task:SPRINT_LORE_MD_ARCHIVE/MDA-04 (в образец не выгружена)

## Контекст

Запрос владельца 04.11.2026: «давай ещё сделаем опцию: выгрузить локально актуальные данные по проекту в MD-архив — это отдельным спринтом».

Спека формата: [[SPEC-LORE-VAULT-EXPORT|spec:SPEC-LORE-VAULT-EXPORT]]. Решение об Arrow (отложено, не отменено): [[D-2026-LORE-MD-ARCHIVE-ARROW-FLIGHT|decision:D-2026-LORE-MD-ARCHIVE-ARROW-FLIGHT]].

## Результат

Одной командой получить на диске папку Markdown-файлов с текущим состоянием проекта. Она читается без LORE, ссылки внутри работают, повторная выгрузка без изменений в базе даёт тот же результат байт в байт.
