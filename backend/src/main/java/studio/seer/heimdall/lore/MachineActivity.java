package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-ACT-1 — порог активности машины и harness.
 *
 * <p><b>Слово владелицы 11.11 (дословно):</b> «по DSH предлагаю в админку на машину и harness
 * выставить настройки (считать активной в течении — от часа после последнего вызова до суток)».
 * Сессия активна, если с последнего вызова прошло не больше окна.
 *
 * <p><b>Где живёт.</b> На акторе-машине ({@code KnowActor(kind=agent, client_id minilore-link-*)}) —
 * той же вершине, на которой права машины (ADR-MINILORE-007 В4, {@link MachineAccess}):
 * <ul>
 *   <li>{@code activity_window_h} — окно машины в часах, 1..24; пусто — общий дефолт {@link #DEFAULT_H};</li>
 *   <li>{@code activity_window_harness} — окна по harness на этой машине ({@code {"dsh": 24}}), ключи
 *       из справочника {@code harness}; перекрывают окно машины.</li>
 * </ul>
 * Читается срезами {@code machine_acl} и {@code agent_owners}; правило выбора — {@link #effective}.
 * Пишет владелец машины или admin ({@link MachineAccess#canManage}), агент — никогда.
 */
final class MachineActivity {

    private MachineActivity() {}

    static final int MIN_H = 1;
    static final int MAX_H = 24;

    /**
     * Общий дефолт, когда ни машина, ни harness окна не задали. Гипотеза: нижняя граница
     * диапазона владелицы («от часа») — ближайшее к прежним жёстким 90 с / 5 мин демона (KDP-30).
     */
    static final int DEFAULT_H = 1;

    static final String FIELD = "activity_window_h";
    static final String HARNESS_FIELD = "activity_window_harness";

    /** V81: два свойства актора-машины — только аддитивные идемпотентные формы. */
    static final List<String> SCHEMA_SQL = List.of(
        "CREATE PROPERTY KnowActor.activity_window_h IF NOT EXISTS INTEGER",
        "CREATE PROPERTY KnowActor.activity_window_harness IF NOT EXISTS MAP");

    // ── модель ─────────────────────────────────────────────────────────────

    /** Настройка машины: окно машины (null — дефолт) и окна по harness (пусто — нет). */
    record Setting(Integer windowH, Map<String, Integer> harness) {
        Setting {
            harness = harness == null ? Map.of() : Map.copyOf(new TreeMap<>(harness));
        }
    }

    /** @param basis {@code harness} | {@code machine} | {@code default} — откуда взято окно */
    record Effective(int hours, String basis) {}

    /** Окно для harness на машине: harness → машина → общий дефолт. */
    static Effective effective(Setting s, String harness) {
        if (s != null && harness != null && s.harness().get(harness) != null)
            return new Effective(s.harness().get(harness), "harness");
        if (s != null && s.windowH() != null) return new Effective(s.windowH(), "machine");
        return new Effective(DEFAULT_H, "default");
    }

    /** Активна ли: с последнего вызова прошло не больше окна. Отметки нет — не активна. */
    static boolean active(Long minutesSinceLast, int windowH) {
        return minutesSinceLast != null && minutesSinceLast <= (long) windowH * 60;
    }

    /** Настройка из строки среза; мусор (не число) пропускается, а не роняет чтение. */
    static Setting settingOf(Map<String, Object> row) {
        Integer w = row == null ? null : intOf(row.get(FIELD));
        Map<String, Integer> h = new LinkedHashMap<>();
        if (row != null && row.get(HARNESS_FIELD) instanceof Map<?, ?> m)
            for (Map.Entry<?, ?> e : m.entrySet()) {
                Integer v = intOf(e.getValue());
                if (e.getKey() != null && v != null) h.put(String.valueOf(e.getKey()), v);
            }
        return new Setting(w, h);
    }

    private static Integer intOf(Object v) {
        return v instanceof Number n ? n.intValue() : null;
    }

    // ── запрос записи ─────────────────────────────────────────────────────

    /**
     * Полное желаемое состояние (не дельта): {@code window_h} null — снять окно машины (общий
     * дефолт), {@code harness} null/пусто — снять окна по harness. Повтор того же — unchanged.
     */
    record Request(String machine_id, Integer window_h, Map<String, Integer> harness, Boolean dry_run) {}

    static String requestError(Request r, List<String> allowedHarnesses) {
        if (r == null) return "body required";
        if (r.machine_id() == null || r.machine_id().isBlank()) return "machine_id required";
        if (!AgentMachine.SAFE.matcher(r.machine_id()).matches())
            return "machine_id недопустим (ожидается [A-Za-z0-9_.-], до 64 символов)";
        if (r.window_h() != null && outOfRange(r.window_h()))
            return "window_h: окно в часах 1..24 (пришло " + r.window_h() + "); null — общий дефолт " + DEFAULT_H + " ч";
        if (r.harness() != null)
            for (Map.Entry<String, Integer> e : r.harness().entrySet()) {
                if (e.getKey() == null || !allowedHarnesses.contains(e.getKey()))
                    return "harness: '" + e.getKey() + "' нет в справочнике harness " + allowedHarnesses;
                if (e.getValue() == null || outOfRange(e.getValue()))
                    return "harness." + e.getKey() + ": окно в часах 1..24 (пришло " + e.getValue() + ")";
            }
        return null;
    }

    private static boolean outOfRange(int h) {
        return h < MIN_H || h > MAX_H;
    }

    static Setting target(Request r) {
        return new Setting(r.window_h(), r.harness());
    }

    static Map<String, Object> view(Setting s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("window_h", s.windowH());
        m.put("harness", s.harness());
        return m;
    }

    /** План «было → станет»: kind = update | unchanged; общий дефолт — рядом, чтобы «пусто» читалось. */
    static Map<String, Object> plan(Setting before, Request r) {
        Setting b = before == null ? new Setting(null, Map.of()) : before;
        Setting a = target(r);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("kind", Objects.equals(b.windowH(), a.windowH()) && b.harness().equals(a.harness()) ? "unchanged" : "update");
        p.put("before", view(b));
        p.put("after", view(a));
        p.put("default_h", DEFAULT_H);
        return p;
    }

    /**
     * UPDATE машины. Значения — литералом: числа проверены ({@link #requestError}), ключи — коды
     * справочника; параметр-коллекция в SET ArcadeDB отвергает 400 (CI 11.11, #1225), а «:by» — ключевое
     * слово. Пустая карта пишется null: «окон по harness нет», а не пустой объект.
     */
    static String updateSql(Setting s) {
        StringBuilder b = new StringBuilder("UPDATE KnowActor SET " + FIELD + " = ")
            .append(s.windowH() == null ? "null" : String.valueOf(s.windowH()))
            .append(", " + HARNESS_FIELD + " = ");
        if (s.harness().isEmpty()) b.append("null");
        else {
            b.append('{');
            boolean first = true;
            for (Map.Entry<String, Integer> e : s.harness().entrySet()) {
                if (!first) b.append(", ");
                first = false;
                b.append('\'').append(e.getKey().replace("\\", "\\\\").replace("'", "\\'")).append("': ").append(e.getValue());
            }
            b.append('}');
        }
        return b.append(" WHERE kind = 'agent' AND client_id = :c").toString();
    }

    // ── обогащение machine_acl ────────────────────────────────────────────

    /** Когда машины были на связи: отметки вершин-наблюдений KnowMachine (V79). */
    static final String LAST_SEEN_SQL = "SELECT machine_id, last_seen_at FROM KnowMachine";

    /**
     * Дописывает в строки machine_acl {@code last_seen_at} (KnowMachine той же машины; прочитано,
     * но не видели — null) и {@code activity_default_h}. {@code machines} null — источник не
     * прочитан: поля {@code last_seen_at} нет, а не «никогда».
     */
    static void enrichAcl(List<Map<String, Object>> rows, List<Map<String, Object>> machines) {
        Map<String, Object> seen = new LinkedHashMap<>();
        if (machines != null)
            for (Map<String, Object> m : machines)
                if (m != null && m.get("machine_id") != null) seen.put(String.valueOf(m.get("machine_id")), m.get("last_seen_at"));
        for (Map<String, Object> r : rows) {
            r.put("activity_default_h", DEFAULT_H);
            if (machines == null) continue;
            Object c = r.get("client_id");
            String client = c == null ? "" : String.valueOf(c);
            String id = client.startsWith(MachineAccess.PREFIX) ? client.substring(MachineAccess.PREFIX.length()) : null;
            r.put("last_seen_at", id == null ? null : seen.get(id));
        }
    }
}
