package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Пакет 1.18 — имена людей из Keycloak, чистая часть (без базы; KC — через {@link KcOps.KcCall}).
 * Владелица 21.11.2026: «у людей из KC то ФИО достань, а то только логины»; порядок — «Имя Фамилия».
 *
 * <p>Имя человека — {@code KnowUser.display_name}; откуда оно — {@code KnowUser.name_source}:
 * <ul>
 *   <li>{@code manual} — задано человеком (или админом) в профиле: сверка с KC его не трогает;</li>
 *   <li>{@code kc} — ФИО из KC: обновляется, когда в KC поменялось;</li>
 *   <li>пусто — источник не записан: имя совпадает с логином (логин — подпись по умолчанию) — берём ФИО из KC;
 *       имя отличается от логина — оно задано до этой задачи человеком, считаем его своим и не трогаем.</li>
 * </ul>
 * Нет ФИО в KC — остаётся логин, и человек попадает в «без имени в KC», а не молча. В KC ничего не пишется:
 * учётки читаются {@code GET /users} постранично ({@link KcOps#listAllUsers}).
 */
final class KcUserNames {

    private KcUserNames() {}

    static final String MANUAL = "manual";
    static final String KC = "kc";

    /** «Имя Фамилия»; есть одно — оно; нет ничего — null (не пустая строка). */
    static String fullName(String first, String last) {
        String f = trim(first), l = trim(last);
        if (f == null) return l;
        if (l == null) return f;
        return f + " " + l;
    }

    /** Одна запись к обновлению: новое имя и логин, который надо сохранить (у записей до V92 он жил в display_name). */
    record Update(String kcSub, String name, String login) {}

    /** План сверки: что обновить и почему остальное не тронуто — каждой группой. */
    record Plan(List<Update> updates, int unchanged, int manualKept, List<String> noNameInKc, List<String> notInKc, int checked) {
        int updated() { return updates.size(); }

        Map<String, Object> summary() {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("checked", checked);
            m.put("updated", updates.size());
            m.put("unchanged", unchanged);
            m.put("manual_kept", manualKept);
            m.put("no_name_in_kc", noNameInKc.size());
            m.put("not_in_kc", notInKc.size());
            m.put("no_name_in_kc_subs", noNameInKc);
            m.put("not_in_kc_subs", notInKc);
            return m;
        }

        /**
         * Итог после записи: {@code missed} — у кого запись не нашла строку (WriteCount = 0: человека удалили между
         * чтением и записью). Они не «обновлены» — названы отдельно (сторож UpdateAffectedRowsGuardTest).
         */
        Map<String, Object> summaryAfterWrite(List<String> missedSubs) {
            Map<String, Object> m = summary();
            m.put("updated", updates.size() - missedSubs.size());
            m.put("missed", missedSubs.size());
            m.put("missed_subs", List.copyOf(missedSubs));
            return m;
        }
    }

    /** Имя задано человеком: явная отметка или (до отметок) имя, отличное от логина. */
    static boolean isManual(Map<String, Object> row) {
        String source = trim(str(row.get("name_source")));
        if (MANUAL.equals(source)) return true;
        if (KC.equals(source)) return false;
        String login = trim(str(row.get("login")));
        String name = trim(str(row.get("display_name")));
        return login != null && name != null && !name.equals(login);
    }

    static Plan plan(List<Map<String, Object>> graphUsers, JsonArray kcUsers) {
        Map<String, JsonObject> bySub = new HashMap<>();
        for (int i = 0; i < kcUsers.size(); i++) {
            JsonObject u = kcUsers.getJsonObject(i);
            if (u != null && u.getString("id") != null) bySub.put(u.getString("id"), u);
        }
        List<Update> updates = new ArrayList<>();
        List<String> noName = new ArrayList<>(), notInKc = new ArrayList<>();
        int unchanged = 0, manual = 0;
        for (Map<String, Object> r : graphUsers) {
            String sub = str(r.get("kc_sub"));
            if (sub == null) continue;
            JsonObject u = bySub.get(sub);
            if (u == null) { notInKc.add(sub); continue; }
            if (isManual(r)) { manual++; continue; }
            String name = fullName(u.getString("firstName"), u.getString("lastName"));
            if (name == null) { noName.add(sub); continue; }
            if (name.equals(trim(str(r.get("display_name")))) && KC.equals(trim(str(r.get("name_source"))))) { unchanged++; continue; }
            String login = trim(str(r.get("login")));
            if (login == null) login = trim(str(r.get("display_name")));
            if (login == null) login = trim(u.getString("username"));
            updates.add(new Update(sub, name, login));
        }
        return new Plan(List.copyOf(updates), unchanged, manual, List.copyOf(noName), List.copyOf(notInKc), graphUsers.size());
    }

    /** Учётки KC постранично (только GET) и план; KC не ответил — {@link KcOps.KcFailed}, а не план по логинам. */
    static Plan planFromKc(KcOps.KcCall kc, List<Map<String, Object>> graphUsers) throws Exception {
        return plan(graphUsers, KcOps.listAllUsers(kc, KcOps.PAGE));
    }

    /** Пора ли сверять при открытии раздела: первого прогона не было или он старше окна. */
    static boolean due(Instant last, Instant now, Duration every) {
        return last == null || !last.plus(every).isAfter(now);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static String trim(String s) {
        if (s == null) return null;
        String t = s.strip();
        return t.isEmpty() ? null : t;
    }
}
