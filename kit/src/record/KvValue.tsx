// Поле «ключ → значение» с вложенностью (SPRINT_UXR_S13_KIT4/K4-FIELD-KV).
//
// Повод — «Дата-странники»: правила игры приходят вложенным объектом, а поле вида text выводило
// сырой JSON. Прототип — kit_gaps_v1.html, раздел К2 (владелица 15.11: «заводи спринт kit4»).
// В LORE пригодится для настроек, паспортов и конфигов.
//
// Раскладка:
//   • скаляр — строка «ключ — значение», значение моношрифтом;
//   • вложенный объект — группа с ▾ (родной <details>), раскрыта, сворачивается;
//   • список объектов — подтаблица, колонки — объединение ключей, пропуск — «—»;
//   • список скаляров — через запятую;
//   • `_doc` — пояснение, его выводит приложение; строкой не показываем.
// Пусто (или только `_doc`) — «—», а не пустая рамка. На узком экране таблица прокручивается
// внутри своей рамки, а не весь экран.
import type { ReactNode } from 'react';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const DOC = '_doc';

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return value;
  try { return JSON.parse(s); } catch { return value; }
}

function scalar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map(scalar).join(', ');
  if (isObj(v)) return JSON.stringify(v);
  return String(v);
}

const ownKeys = (o: Obj) => Object.keys(o).filter(k => k !== DOC);

function SubTable({ name, rows }: { name: string; rows: Obj[] }) {
  const cols: string[] = [];
  for (const r of rows) for (const k of ownKeys(r)) if (!cols.includes(k)) cols.push(k);
  return (
    <div className="sk-kv__scroll">
      <table className="sk-kv__sub" data-testid={`kit-kv-table-${name}`}>
        <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map(c => <td key={c} className="sk-kv__val">{scalar(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rows({ obj }: { obj: Obj }): ReactNode {
  const keys = ownKeys(obj);
  const plain = keys.filter(k => !isObj(obj[k]) && !(Array.isArray(obj[k]) && (obj[k] as unknown[]).some(isObj)));
  const nested = keys.filter(k => !plain.includes(k));
  return (
    <>
      {plain.length > 0 && (
        <table className="sk-kv__rows">
          <tbody>
            {plain.map(k => (
              <tr key={k}><th scope="row" className="sk-kv__key">{k}</th><td className="sk-kv__val">{scalar(obj[k])}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {nested.map(k => {
        const v = obj[k];
        return (
          <details key={k} className="sk-kv__group" open>
            <summary className="sk-kv__key">{k}</summary>
            {Array.isArray(v) ? <SubTable name={k} rows={v.filter(isObj)} /> : <Rows obj={v as Obj} />}
          </details>
        );
      })}
    </>
  );
}

export function KvValue({ value, label }: { value: unknown; label: string }) {
  const v = parsed(value);
  if (Array.isArray(v) && v.some(isObj)) {
    return <div className="sk-kv" data-testid="kit-kv" role="group" aria-label={label}><SubTable name="items" rows={v.filter(isObj)} /></div>;
  }
  if (!isObj(v)) return <span className="sk-rec-fields__mono">{scalar(v)}</span>;
  if (ownKeys(v).length === 0) return <span className="sk-rec-fields__none">—</span>;
  return <div className="sk-kv" data-testid="kit-kv" role="group" aria-label={label}><div className="sk-kv__scroll"><Rows obj={v} /></div></div>;
}
