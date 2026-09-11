package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.List;

/**
 * AO-05: разбор блока «Роли из снятых полей», который шаг V38 дописал в
 * примечания задач перед снятием полей роли (V39).
 *
 * <p>Блок имеет ровно одну форму — её и печатал V38:
 * <pre>
 * &lt;!-- roles-from-dropped-fields --&gt;
 * **Роли из снятых полей** (не сопоставлены …): author = rollout; executor = minilore-app.
 * </pre>
 * Разбирается ТОЛЬКО строка, идущая сразу за меткой. Всё остальное примечание —
 * проза, и в ней та же метка может быть процитирована (так и случилось: два
 * примечания цитировали её в тексте, и счёт «124 против 123» родился именно
 * из поиска по подстроке). Поэтому признак — метка на СВОЕЙ строке плюс
 * следующая строка с жирным заголовком, а не вхождение подстроки.
 *
 * <p>Значение берётся ДОСЛОВНО (решение владельца 31.08.2026: «где» пишется
 * как есть, без приведения к общему виду). Единственное, что снимается, —
 * завершающая точка строки, поставленная V38, и пробелы по краям.
 */
final class DroppedRoleNote {

    private DroppedRoleNote() {}

    static final String MARKER = "<!-- roles-from-dropped-fields -->";
    static final String HEADING = "**Роли из снятых полей**";

    /** Одна роль из блока: какая роль и что стояло в снятом поле. */
    record Entry(String role, String origin) {}

    /**
     * Роли из блока V38, в порядке записи. Пусто — если блока нет или строка
     * после метки не той формы; это НЕ ошибка: метка в прозе законна.
     */
    static List<Entry> parse(String noteMd) {
        List<Entry> out = new ArrayList<>();
        if (noteMd == null || noteMd.isBlank()) return out;
        String[] lines = noteMd.split("\r?\n");
        for (int i = 0; i < lines.length - 1; i++) {
            if (!lines[i].trim().equals(MARKER)) continue;
            String next = lines[i + 1].trim();
            if (!next.startsWith(HEADING)) continue;
            int colon = next.indexOf("): ");
            if (colon < 0) continue;
            String body = next.substring(colon + 3).trim();
            if (body.endsWith(".")) body = body.substring(0, body.length() - 1);
            for (String part : body.split(";")) {
                int eq = part.indexOf(" = ");
                if (eq < 0) continue;
                String role = part.substring(0, eq).trim();
                String origin = part.substring(eq + 3).trim();
                if (!TaskRole.ALL.contains(role) || origin.isEmpty()) continue;
                out.add(new Entry(role, origin));
            }
            return out; // блок один; второй такой же V38 не писал
        }
        return out;
    }
}
