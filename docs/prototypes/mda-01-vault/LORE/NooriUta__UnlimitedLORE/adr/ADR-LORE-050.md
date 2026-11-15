---
id: ADR-LORE-050
type: adr
title: "Ссылка на объект LORE прямо в MD: «[[», «@» и «#тип» открывают одно мини-окно «выбрать существующий или завести новый», правка полей — в паспорте"
status: accepted
date: 2026-11-10
project: "[[NooriUta__UnlimitedLORE/index|NooriUta/UnlimitedLORE]]"
components:
  - "[[OMILORE]]"
  - "FORSETI"
tags:
  - kit-contract
  - supertag
  - md-editor
decisions:
  - "[[D-2026-LORE-MD-REF-THREE-TRIGGERS]]"
---

# ADR-LORE-050

## Решения

- [[D-2026-LORE-MD-REF-THREE-TRIGGERS|decision:D-2026-LORE-MD-REF-THREE-TRIGGERS]] — одно окно, один токен `[[тип:ID]]`
- decision:D-2026-LORE-MD-REF-EDIT-IN-PASSPORT (в образец не выгружено)
- decision:D-2026-LORE-MD-REF-TWO-CARDS (в образец не выгружено)

## 4. Выбор — вариант А (фрагмент)

1. **Тег = объект LORE, а не новая сущность.** В тело MD ложится `[[тип:ID]]` — формат, который уже разбирает `markdownWiki.ts`.
2. **Одно окно, три способа вызова** (Обсидиан + Tana).
3. **Мини-окно — две карточки**: поиск идёт через службу поиска (adr:ADR-LORE-033, вне архива).
