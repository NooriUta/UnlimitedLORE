package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Раздел {@code workflow} модели — SPRINT_LORE_WORK_ANY_KIND/WK-05, прототип wk-05-workflow
 * (одобрен 14.11.2026 вместе с развилками А–Г).
 *
 * <p>{@code moves} — разрешённые переходы между статусами ядра ({@link LoreWorkflowCore}); done —
 * только из review. {@code kinds} — вид работы: какие типы задач к нему относятся, стадии внутри
 * active/waiting, стадии приёмки внутри review и чем доказывается done. Сам гейт перехода в done
 * читает этот раздел; клиент рисует по нему паспорт и окно смены статуса.
 */
final class LoreModelWorkflow {

    private LoreModelWorkflow() {}

    /** Тип доказательства done и его подпись. */
    record Evidence(String type, String label) {}

    /** Вид работы. {@code failed} — как называется отрицательный исход, null — у вида его нет. */
    record Kind(String label, List<String> types, List<String> stages, List<String> review_stages,
                List<Evidence> evidence, String failed) {}

    record Workflow(Map<String, List<String>> moves, Map<String, Kind> kinds) {
        /** Вид работы по типу задачи; null — тип не отнесён ни к одному виду. */
        String kindOf(String taskType) {
            if (taskType == null) return null;
            for (Map.Entry<String, Kind> e : kinds.entrySet())
                if (e.getValue().types().contains(taskType)) return e.getKey();
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    static Workflow parse(Object raw) {
        if (!(raw instanceof Map<?, ?> m)) throw new IllegalStateException("файл модели: «workflow» — ждали объект");
        Map<String, List<String>> moves = new LinkedHashMap<>();
        if (!(m.get("moves") instanceof Map<?, ?> mv)) throw new IllegalStateException("файл модели: workflow.moves — ждали объект");
        mv.forEach((k, v) -> {
            if (!(v instanceof List<?> l)) throw new IllegalStateException("файл модели: workflow.moves." + k + " — ждали список");
            List<String> to = new ArrayList<>();
            for (Object o : l) to.add(String.valueOf(o));
            moves.put(String.valueOf(k), List.copyOf(to));
        });
        Map<String, Kind> kinds = new LinkedHashMap<>();
        if (!(m.get("kinds") instanceof Map<?, ?> kd)) throw new IllegalStateException("файл модели: workflow.kinds — ждали объект");
        kd.forEach((k, v) -> kinds.put(String.valueOf(k), LoreModelCodec.decode(Kind.class, v, "workflow.kinds." + k)));
        return new Workflow(java.util.Collections.unmodifiableMap(moves), java.util.Collections.unmodifiableMap(kinds));
    }

    /** Согласованность: переходы только между статусами ядра, done — только из review, тип задачи — в одном виде. */
    static List<String> problems(Workflow w) {
        List<String> out = new ArrayList<>();
        for (String s : LoreWorkflowCore.CORE) if (!w.moves().containsKey(s)) out.add("workflow.moves: нет статуса ядра " + s);
        w.moves().forEach((from, to) -> {
            if (!LoreWorkflowCore.CORE.contains(from)) out.add("workflow.moves: «" + from + "» не статус ядра");
            for (String t : to) {
                if (!LoreWorkflowCore.CORE.contains(t)) out.add("workflow.moves." + from + ": «" + t + "» не статус ядра");
                if ("done".equals(t) && !"review".equals(from)) out.add("workflow.moves." + from + ": done ставится только из review");
            }
        });
        Map<String, String> owner = new TreeMap<>();
        w.kinds().forEach((k, kind) -> {
            if (kind.evidence().isEmpty()) out.add("workflow.kinds." + k + ": нет доказательства done");
            for (String t : kind.types()) {
                String prev = owner.put(t, k);
                if (prev != null) out.add("workflow: тип задачи «" + t + "» в двух видах — " + prev + " и " + k);
            }
        });
        return out;
    }

    static Map<String, Object> render(Workflow w) {
        Map<String, Object> d = new LinkedHashMap<>();
        Map<String, Object> moves = new LinkedHashMap<>();
        for (String s : LoreWorkflowCore.CORE) if (w.moves().containsKey(s)) moves.put(s, w.moves().get(s));
        w.moves().forEach(moves::putIfAbsent);
        d.put("moves", moves);
        Map<String, Object> kinds = new LinkedHashMap<>();
        w.kinds().forEach((k, v) -> kinds.put(k, LoreModelCodec.encode(v)));
        d.put("kinds", kinds);
        return d;
    }

    /** Блок /lore/model: ядро и синонимы (словарь статусов) плюс раздел модели. */
    static Map<String, Object> surface(Workflow w) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("core", LoreWorkflowCore.CORE);
        Map<String, Object> syn = new TreeMap<>();
        LoreWorkflowCore.SYNONYMS.forEach((k, v) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("core", v.core());
            m.put("stage", v.stage());
            syn.put(k, m);
        });
        d.put("synonyms", syn);
        d.putAll(render(w));
        return d;
    }
}
