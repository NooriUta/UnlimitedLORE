package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Сторож «один путь изменений схемы после 1.18» (владелец 25.11.2026: «подчисти версионирование, а то следующие будут
 * тоже делать»). После 1.18 база прода собрана из модели, шаги V на неё не катятся — шаг V, добавленный после 1.18,
 * молча не доезжал до прода (V94–V100). Правило: новое изменение схемы (тип, поле, индекс, ребро, посев) — только
 * запись в {@link LoreSchemaAdditive#CHANGES}; доводка применяет его к базе из модели, к базе шагов V и к свежей
 * установке одинаково. Шаги V заморожены.
 */
class LoreSchemaAdditiveGuardTest {

    /** Последний шаг V, вошедший в модель 1.18 (тег v1.18.0: V93). Всё, что новее, обязано иметь путь доводки. */
    private static final int MODEL_BASELINE_V = 93;

    @Test
    void шагиV_заморожены_новое_изменение_схемы_только_доводкой() {
        assertEquals(LoreSchemaAdditive.LAST_V_STEP, LoreSchemaMigrations.codeVersion(),
            "шаги V заморожены на V" + LoreSchemaAdditive.LAST_V_STEP + ": база прода собрана из модели, шаг V на неё не катится "
                + "и молча не доедет. Новое изменение схемы — запись в LoreSchemaAdditive.CHANGES (+ поднять VERSION), "
                + "а не new Step(" + (LoreSchemaMigrations.codeVersion()) + ", …)");
    }

    @Test
    void каждый_шагV_после_модели_118_имеет_путь_доводки() {
        List<String> bad = new ArrayList<>();
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
            if (s.version() <= MODEL_BASELINE_V) continue;
            String id = LoreSchemaAdditive.FROM_V_STEPS.get(s.version());
            if (id == null) { bad.add("V" + s.version() + " (" + s.name() + "): нет в FROM_V_STEPS"); continue; }
            LoreSchemaAdditive.Change c = LoreSchemaAdditive.change(id);
            if (c == null) { bad.add("V" + s.version() + " → " + id + ": такой записи в CHANGES нет"); continue; }
            List<String> missing = s.sql().stream().filter(q -> !c.ddl().contains(q)).toList();
            if (!missing.isEmpty()) bad.add("V" + s.version() + ": стейтментов нет в доводке " + id + ": " + missing);
            if (s.sql().isEmpty() && c.seed() == null) bad.add("V" + s.version() + " — Java-шаг (посев), а у " + id + " посева нет");
        }
        assertTrue(bad.isEmpty(), "шаг V после 1.18 без пути на базу из модели:\n  " + String.join("\n  ", bad));
    }

    @Test
    void записи_доводки_идемпотентны_по_построению() {
        Set<String> ids = new HashSet<>();
        for (LoreSchemaAdditive.Change c : LoreSchemaAdditive.CHANGES) {
            assertTrue(ids.add(c.id()), "id доводки повторяется: " + c.id());
            assertFalse(c.why().isBlank(), c.id() + ": причина (задача/спека) пустая");
            for (String q : c.ddl()) {
                String u = q.toUpperCase();
                assertTrue(u.startsWith("CREATE "), c.id() + ": доводка только создаёт, а не меняет/удаляет: " + q);
                assertTrue(u.contains("IF NOT EXISTS"), c.id() + ": стейтмент без IF NOT EXISTS — повтор упадёт: " + q);
            }
            assertTrue(!c.ddl().isEmpty() || c.seed() != null, c.id() + ": пустая запись");
        }
    }

    @Test
    void инициализатор_не_растёт_мимо_доводки() {
        // Свежая установка шагами V сначала гоняет DDL инициализатора. Новый CREATE там, которого нет в доводке, дошёл бы
        // до свежей базы, но не до базы из модели. Счёт стейтментов инициализатора вне доводки заморожен на 1.18.
        Set<String> additive = new HashSet<>();
        LoreSchemaAdditive.CHANGES.forEach(c -> additive.addAll(c.ddl()));
        long outside = LoreSchemaInitializer.DDL.stream().filter(q -> !additive.contains(q)).count();
        assertEquals(INITIALIZER_FROZEN, outside,
            "LoreSchemaInitializer.DDL изменился мимо доводки (вне доводки было " + INITIALIZER_FROZEN + ", стало " + outside + "). "
                + "Новый тип/поле/индекс — запись в LoreSchemaAdditive.CHANGES; инициализатор может лишь ссылаться на её DDL");
    }

    /** Стейтментов LoreSchemaInitializer.DDL вне доводки — состояние 1.18 (зеркало KnowKind V94 — уже ссылка на доводку). */
    private static final long INITIALIZER_FROZEN = 388L;

    @Test
    void номер_схемы_кода_поднят_при_изменении_доводки() {
        String hash = LoreSchemaAdditive.hash();
        assertTrue(LoreSchemaAdditive.PINNED.containsKey(LoreSchemaAdditive.VERSION),
            "номер схемы кода " + LoreSchemaAdditive.VERSION + " не закреплён в PINNED");
        assertEquals(LoreSchemaAdditive.PINNED.get(LoreSchemaAdditive.VERSION), hash,
            "доводка изменилась (хэш " + LoreSchemaAdditive.PINNED.get(LoreSchemaAdditive.VERSION) + " → " + hash + ") при том же номере "
                + LoreSchemaAdditive.VERSION + ": поднимите LoreSchemaAdditive.VERSION и закрепите новый хэш в PINNED "
                + "(прежние номера не правятся — их отметка уже лежит в базах)");
        assertEquals(new HashSet<>(LoreSchemaAdditive.PINNED.values()).size(), LoreSchemaAdditive.PINNED.size(),
            "у двух номеров один хэш — номер поднят без изменения доводки");
        for (int v = 1; v <= LoreSchemaAdditive.VERSION; v++)
            assertTrue(LoreSchemaAdditive.PINNED.containsKey(v), "история номеров не прерывается: нет " + v);
    }

    @Test
    void хэш_доводки_детерминирован() {
        assertEquals(LoreSchemaAdditive.hash(), LoreSchemaAdditive.hash());
        assertTrue(LoreSchemaAdditive.hash().matches("[0-9a-f]{16}"), LoreSchemaAdditive.hash());
    }

    @Test
    void тип_доводки_вне_модели_помечен_с_причиной() throws Exception {
        // На базе из модели, где доводку ещё не накатили, срез такого типа отвечает причиной, а не 502.
        Set<String> model = OutsideModelTypesGuardTest.known();
        Set<String> bad = new TreeSet<>();
        for (String t : LoreSchemaAdditive.createdTypes())
            if (!model.contains(t) && !ModelSchemaAdapter.OUTSIDE_MODEL.containsKey(t)) bad.add(t);
        assertTrue(bad.isEmpty(), "тип доводки вне модели 1.18 без пометки ModelSchemaAdapter.OUTSIDE_MODEL: " + bad);
        for (String t : List.of("KnowKind", "KnowKindHist", "KnowSkill", "APPLIES_TO_ROLE", "SKILL_EXTENDS"))
            assertTrue(LoreSchemaAdditive.createdTypes().contains(t), t + " заводит доводка");
    }

    @Test
    void шагиV94_V100_ссылаются_на_доводку_а_не_держат_копию() {
        // Один источник правды: SQL шагов V94–V96 — те же списки, что у доводки. Контрольные суммы выпущенных шагов
        // не сдвинулись (сняты с develop до переноса, caed8898) — иначе базы шагов V отказали бы старту.
        Map<Integer, String> released = Map.of(94, "8bedc33c5c1f9fb0", 95, "a081c7f46fb3ffb5", 96, "0f26a38540c4cb94");
        int seen = 0;
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS)
            if (released.containsKey(s.version())) {
                seen++;
                assertSame(LoreSchemaAdditive.change(LoreSchemaAdditive.FROM_V_STEPS.get(s.version())).ddl(), s.sql(),
                    "V" + s.version() + " держит свою копию DDL вместо ссылки на доводку");
                assertEquals(released.get(s.version()), s.checksum(), "V" + s.version() + ": контрольная сумма выпущенного шага сдвинулась");
            }
        assertEquals(3, seen);
    }
}
