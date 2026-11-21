// Поля шапки записи рядом со статусом (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-12): «Ждём: …», «Причина статуса: …».
// Что показывать, решает документ записи (поля группы head, кроме названия, статуса и кодов) и сервер (значения
// есть только там, где они правда о нынешнем статусе). Kit не знает имён полей — только раскладывает.
import type { KitRecord } from '../core/contract';
import { STATUS_NOTES_KEY, type StatusNote } from './recordDoc';

export function StatusNotes({ record }: { record: KitRecord }) {
  const notes = record.fields[STATUS_NOTES_KEY] as StatusNote[] | undefined;
  if (!Array.isArray(notes) || !notes.length) return null;
  return (
    <>
      {notes.map(n => (
        <span key={n.key} className="sk-rec-snote" data-testid="kit-status-note" data-key={n.key}>{`${n.label}: ${n.value}`}</span>
      ))}
    </>
  );
}
