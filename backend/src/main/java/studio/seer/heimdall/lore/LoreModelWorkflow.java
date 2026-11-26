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

    /**
     * Вид работы. {@code failed} — как называется отрицательный исход, null — у вида его нет.
     * {@code moves} — свои переходы вида (UW-L0-SPEC, вариант 1а, владелец 26.11): подмножество
     * {@code workflow.moves}; null — вид наследует общие переходы. Статусы у всех видов одни и те же.
     */
    record Kind(String label, List<String> types, List<String> stages, List<String> review_stages,
                List<Evidence> evidence, String failed, Map<String, List<String>> moves, List<StageIo> flow) {
        /** Вид без канала артефактов — как до 26.11. */
        Kind(String label, List<String> types, List<String> stages, List<String> review_stages,
             List<Evidence> evidence, String failed, Map<String, List<String>> moves) {
            this(label, types, stages, review_stages, evidence, failed, moves, List.of());
        }
    }

    /**
     * Артефакт канала {@code workflow.artifacts} (владелец 26.11.2026: «сделай канал artifacts и produces/consumes»).
     * {@code source}: {@code stage} — появляется только как выход стадии; {@code record} — запись LORE (ADR,
     * сценарий, спека…), может существовать до workflow, поэтому её можно потреблять без производителя.
     * {@code evidence} — тип доказательства done, которое этот артефакт закрывает; null — не доказательство.
     */
    record Artifact(String label, String source, String evidence) {}

    /** Что стадия вида производит и потребляет — узел графа UW-02 читает/пишет канал artifacts. */
    record StageIo(String stage, List<String> produces, List<String> consumes) {}

    record Workflow(Map<String, List<String>> moves, Map<String, Kind> kinds, Map<String, Artifact> artifacts) {
        Workflow(Map<String, List<String>> moves, Map<String, Kind> kinds) { this(moves, kinds, Map.of()); }

        /** Вид работы по типу задачи; null — тип не отнесён ни к одному виду. */
        String kindOf(String taskType) {
            if (taskType == null) return null;
            for (Map.Entry<String, Kind> e : kinds.entrySet())
                if (e.getValue().types().contains(taskType)) return e.getKey();
            return null;
        }

        /** Переходы вида: свои, если заданы, иначе общие (неизвестный вид — общие). */
        Map<String, List<String>> movesFor(String kind) {
            Kind k = kind == null ? null : kinds.get(kind);
            return k == null || k.moves() == null ? moves : k.moves();
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
        Map<String, Artifact> artifacts = new LinkedHashMap<>();
        Object ar = m.get("artifacts");
        if (ar != null) {
            if (!(ar instanceof Map<?, ?> am)) throw new IllegalStateException("файл модели: workflow.artifacts — ждали объект");
            am.forEach((k, v) -> artifacts.put(String.valueOf(k), LoreModelCodec.decode(Artifact.class, v, "workflow.artifacts." + k)));
        }
        return new Workflow(java.util.Collections.unmodifiableMap(moves), java.util.Collections.unmodifiableMap(kinds),
            java.util.Collections.unmodifiableMap(artifacts));
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
        w.artifacts().forEach((id, a) -> {
            if (!SOURCES.contains(a.source())) out.add("workflow.artifacts." + id + ": source «" + a.source() + "» — ждали stage или record");
        });
        Map<String, String> owner = new TreeMap<>();
        w.kinds().forEach((k, kind) -> {
            if (kind.evidence().isEmpty()) out.add("workflow.kinds." + k + ": нет доказательства done");
            if (kind.moves() != null) kind.moves().forEach((from, to) -> {
                String where = "workflow.kinds." + k + ".moves";
                if (!LoreWorkflowCore.CORE.contains(from)) { out.add(where + ": «" + from + "» не статус ядра"); return; }
                List<String> allowed = w.moves().getOrDefault(from, List.of());
                for (String t : to) {
                    if (!LoreWorkflowCore.CORE.contains(t)) out.add(where + "." + from + ": «" + t + "» не статус ядра");
                    else if ("done".equals(t) && !"review".equals(from)) out.add(where + "." + from + ": done ставится только из review");
                    else if (!allowed.contains(t)) out.add(where + "." + from + ": переход " + from + " → " + t
                        + " вне общих переходов ядра — вид может только сузить их, не расширить");
                }
            });
            out.addAll(flowProblems(w, k, kind));
            for (String t : kind.types()) {
                String prev = owner.put(t, k);
                if (prev != null) out.add("workflow: тип задачи «" + t + "» в двух видах — " + prev + " и " + k);
            }
        });
        return out;
    }

    static final java.util.Set<String> SOURCES = java.util.Set.of("stage", "record");

    /**
     * Канал артефактов вида: стадия — своя; артефакт — из каталога; потребляемый артефакт стадии
     * (source=stage) произведён стадией РАНЬШЕ (порядок: stages, затем review_stages); каждое
     * доказательство done вида производит какая-то стадия. Вид без flow не проверяется.
     */
    static List<String> flowProblems(Workflow w, String k, Kind kind) {
        List<String> out = new ArrayList<>();
        if (kind.flow() == null || kind.flow().isEmpty()) return out;
        String where = "workflow.kinds." + k + ".flow";
        List<String> order = new ArrayList<>(kind.stages());
        order.addAll(kind.review_stages());
        java.util.Set<String> producedBefore = new java.util.HashSet<>();
        java.util.Set<String> producedAll = new java.util.HashSet<>();
        List<StageIo> sorted = new ArrayList<>(kind.flow());
        sorted.sort(java.util.Comparator.comparingInt(io -> order.indexOf(io.stage()) < 0 ? Integer.MAX_VALUE : order.indexOf(io.stage())));
        for (StageIo io : sorted) {
            if (!order.contains(io.stage())) out.add(where + ": «" + io.stage() + "» не стадия вида (есть: " + order + ")");
            for (String a : io.consumes()) {
                Artifact art = w.artifacts().get(a);
                if (art == null) out.add(where + "." + io.stage() + ".consumes: «" + a + "» нет в workflow.artifacts");
                else if ("stage".equals(art.source()) && !producedBefore.contains(a))
                    out.add(where + "." + io.stage() + ".consumes: «" + a + "» не произведён раньше — его выдаёт только стадия");
            }
            for (String a : io.produces()) {
                if (!w.artifacts().containsKey(a)) out.add(where + "." + io.stage() + ".produces: «" + a + "» нет в workflow.artifacts");
                producedAll.add(a);
            }
            producedBefore.addAll(io.produces());
        }
        for (Evidence e : kind.evidence()) {
            boolean covered = producedAll.stream().map(w.artifacts()::get)
                .anyMatch(a -> a != null && e.type().equals(a.evidence()));
            if (!covered) out.add("workflow.kinds." + k + ": доказательство «" + e.type() + "» не производит ни одна стадия flow");
        }
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
        if (!w.artifacts().isEmpty()) {
            Map<String, Object> arts = new LinkedHashMap<>();
            w.artifacts().forEach((k, v) -> arts.put(k, LoreModelCodec.encode(v)));
            d.put("artifacts", arts);
        }
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
