package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-02 — след источников «к сущности» (рекомендация задачи):
 * у записи, созданной агентом, рёбра SOURCED_FROM на то, что он читал перед записью. Графом
 * обходится «на что опирался ADR». Ребро — своё, не автосвязи упоминаний: «упомянуто в
 * тексте» и «агент читал» смешивать нельзя.
 *
 * <p>Механизм за флагом {@link #FLAG}, по умолчанию ВЫКЛ — включение в проде решает
 * владелица. Выключенный механизм ничего не пишет и об этом говорит; отсутствие следа
 * создание записи не ломает (след шлётся отдельным вызовом ПОСЛЕ создания).
 *
 * <p>Шум: агент за сессию читает десятки записей. Пишутся только последние различные
 * прочитанные — не больше порога ({@code lore.agent.sources.max}, по умолчанию 10, жёсткий
 * потолок {@link #HARD_MAX}); порог уточняется замером на реальной сессии.
 */
final class AgentSourceTrail {

    private AgentSourceTrail() {}

    static final String FLAG = "lore.agent.sources.enabled";
    static final boolean DEFAULT_ENABLED = false;
    static final String MAX = "lore.agent.sources.max";
    static final int DEFAULT_MAX = 10;
    static final int HARD_MAX = 50;

    /** Аддитивно, шаг V88 (V86 влит #1343 — его SQL не меняется; V87 занят WK-05 #1349). */
    static final List<String> DDL = List.of(
        "CREATE EDGE TYPE SOURCED_FROM IF NOT EXISTS",
        "CREATE PROPERTY SOURCED_FROM.at IF NOT EXISTS STRING",
        "CREATE PROPERTY SOURCED_FROM.via IF NOT EXISTS STRING");

    /**
     * Виды записей, которые бывают и следом, и целью. Не все виды модели: у «продукта» ключ —
     * код словаря (не уникален между словарями), люди/агенты/машины/проекты — не источники
     * знания, на которое опирается решение.
     */
    static final Set<String> TRAIL_TYPES = Set.of("adr", "decision", "spec", "task", "sprint", "question",
        "doc", "feature", "milestone", "release", "component", "runbook");

    /** Прочитанное или созданное: вид записи, её ключ и чем читали ({@code via} — инструмент/срез). */
    record Ref(String type, String id, String via) {}

    /**
     * След к записи {@code target}: из {@code reads} (по времени, старые первыми) — последние
     * различные, известного вида, кроме самой записи; не больше {@code max}. Свежие — первыми.
     */
    static List<Ref> plan(Ref target, List<Ref> reads, Set<String> known, int max) {
        List<Ref> out = new ArrayList<>();
        if (reads == null) return out;
        Set<String> seen = new LinkedHashSet<>();
        for (int i = reads.size() - 1; i >= 0 && out.size() < max; i--) {
            Ref r = reads.get(i);
            if (r == null || r.type() == null || r.id() == null || r.id().isBlank()) continue;
            if (!known.contains(r.type())) continue;
            if (target != null && r.type().equals(target.type()) && r.id().equals(target.id())) continue;
            if (!seen.add(r.type() + "\u0000" + r.id())) continue;
            out.add(r);
        }
        return out;
    }

    /** Порог из конфига, зажатый в [1, HARD_MAX]. */
    static int ceiling(int configured) {
        return Math.max(1, Math.min(HARD_MAX, configured));
    }

    /** Ребро цель → источник; ключи — связанными параметрами, повтор не плодит рёбер. */
    static String edgeSql(LoreModelTypes.Graph from, LoreModelTypes.Graph to) {
        return "CREATE EDGE SOURCED_FROM FROM (SELECT FROM " + from.vertex() + " WHERE " + from.key() + " = :tid) "
            + "TO (SELECT FROM " + to.vertex() + " WHERE " + to.key() + " = :sid) IF NOT EXISTS SET at = :at, via = :via";
    }
}
