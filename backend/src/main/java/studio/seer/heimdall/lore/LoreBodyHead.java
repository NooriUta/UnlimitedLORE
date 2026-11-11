package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * «Голова» тела записи в строке среза (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-BODY-MORE).
 *
 * <p>Боль: вид «Лента» у задач, ADR, решений, спек и фич до раскрытия не показывал
 * ничего — тела в строке среза нет, и kit писал «Ещё» над пустым местом. Слово
 * владелицы 10.11.2026: «грузить первые 3 абзаца сразу, остальное при раскрытии».
 *
 * <p>Режется НА СЕРВЕРЕ: строка среза несёт {@code body_head} (до трёх абзацев),
 * {@code body_rest} (сколько абзацев осталось в источнике) и {@code body_more}.
 * Тяжёлое тело в ответ не едет — он легче на порядок (у задач корпус тел — 4 млн
 * символов, SE-01). Остаток клиент берёт паспортом ОДНОЙ записи по раскрытию.
 *
 * <p>Колонки-источники добавляются только к ВЫДАЧЕ среза ({@link #withSources}), а
 * не в описание среза: счётчик раздела, фасеты и лента новостей идут тем же
 * {@code compose} и тянуть тела ради числа не должны.
 *
 * <p>Абзац — кусок между пустыми строками, то же правило, что у web-next
 * ({@code paragraphsOf}): одно правило на голову и на остаток, иначе раскрытие
 * переставляло бы уже показанные абзацы.
 */
final class LoreBodyHead {

    private LoreBodyHead() {}

    /** Префикс служебных колонок: {@code body_src_1}, {@code body_src_2} — по полю тела. */
    static final String SRC = "body_src_";

    /** Сколько абзацев в голове. Число владелицы: «первые 3 абзаца». */
    static final int PARAGRAPHS = 3;

    /**
     * Потолок головы в символах. Абзац бывает таблицей или кодом на десятки
     * килобайт без пустых строк — тогда он режется с «…» и считается остатком:
     * целиком он придёт с раскрытием.
     */
    static final int HEAD_CHARS = 2000;

    /**
     * Поля тела по разделу — в порядке lead web-next и тел паспорта. Выражения — те
     * же, что у паспорта записи ({@code /lore/record}): голова — начало того самого
     * текста, который раскрытие покажет целиком.
     */
    static final Map<String, List<String>> SOURCES = Map.of(
        "adrs", List.of("out('HAS_STATE').context_md[0]", "out('HAS_STATE').decision_md[0]"),
        "open_tasks", List.of("out('HAS_STATE')[note_md IS NOT NULL].note_md[0]"),
        "closed_tasks", List.of("out('HAS_STATE')[note_md IS NOT NULL].note_md[0]"),
        "decisions", List.of("body_md", "rationale_md"),
        "specs", List.of("COALESCE(out('HAS_STATE').content_md[0], content_md)"),
        "use_cases", List.of("context_md", "body_md"));

    private static final Pattern PARA = Pattern.compile("\\r?\\n\\s*\\r?\\n");

    /** SQL выдачи среза с колонками-источниками головы; раздел без головы — как был. */
    static String withSources(String sliceId, String sql) {
        List<String> src = SOURCES.get(sliceId);
        if (src == null || sql == null || !sql.startsWith("SELECT ")) return sql;
        StringBuilder cols = new StringBuilder();
        for (int i = 0; i < src.size(); i++) cols.append(src.get(i)).append(" AS ").append(SRC).append(i + 1).append(", ");
        return "SELECT " + cols + sql.substring("SELECT ".length());
    }

    /** Абзацы текстов по порядку: куски между пустыми строками, пустые выброшены. */
    static List<String> paragraphs(List<Object> texts) {
        List<String> out = new ArrayList<>();
        for (Object t : texts) {
            if (!(t instanceof String s)) continue;
            for (String p : PARA.split(s)) {
                String x = p.strip();
                if (!x.isEmpty()) out.add(x);
            }
        }
        return out;
    }

    /**
     * Свернуть колонки-источники в голову. Служебные колонки наружу не выходят
     * никогда. Тело обнулено правами ({@code body_redacted}) — головы нет вовсе:
     * пустая голова соврала бы «тело пустое».
     */
    static List<Map<String, Object>> fold(List<Map<String, Object>> rows) {
        if (rows == null) return null;
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            if (r == null || !r.containsKey(SRC + "1")) { out.add(r); continue; }
            Map<String, Object> c = new LinkedHashMap<>(r);
            List<Object> texts = new ArrayList<>();
            for (int i = 1; c.containsKey(SRC + i); i++) texts.add(c.remove(SRC + i));
            if (Boolean.TRUE.equals(c.get("body_redacted"))) { out.add(c); continue; }
            // Владелица 11.11.2026: лента — лента паспортов, «с показом раздела „Контекст“»;
            // у типа без него — первый раздел тела. Голова — ОДИН раздел: первый непустой
            // по порядку источников (контекст стоит первым), а не склейка всех разделов.
            int sec = -1;
            for (int i = 0; i < texts.size() && sec < 0; i++) if (!paragraphs(List.of(String.valueOf(texts.get(i) == null ? "" : texts.get(i)))).isEmpty()) sec = i;
            List<String> all = sec < 0 ? List.of() : paragraphs(List.of(texts.get(sec)));
            List<String> head = new ArrayList<>();
            int budget = HEAD_CHARS;
            int whole = 0;
            for (String p : all) {
                if (head.size() >= PARAGRAPHS) break;
                if (p.length() <= budget) {
                    head.add(p);
                    budget -= p.length();
                    whole++;
                } else {
                    head.add(p.substring(0, Math.max(1, budget)) + "…");
                    break;
                }
            }
            int rest = all.size() - whole;
            c.put("body_head", head);
            c.put("body_rest", rest);
            c.put("body_more", rest > 0);
            if (sec >= 0) c.put("body_sec", sec);
            out.add(c);
        }
        return out;
    }
}
