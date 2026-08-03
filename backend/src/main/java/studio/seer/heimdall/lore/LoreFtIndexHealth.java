package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * DBR-08: сверка ПРИГОДНОСТИ полнотекстовых индексов, а не их наличия.
 *
 * <p>Дефект, ради которого это написано, прожил на проде неделю незамеченным.
 * У {@code ftKnowADRHist} и {@code ftKnowTaskHist} индекс СУЩЕСТВОВАЛ, имя
 * совпадало с реестром, {@code CREATE INDEX} отчитывался
 * {@code totalIndexed: 248} — и при этом поиск по телам ADR находил малую часть
 * корпуса, а по телам задач не находил ничего. Наружу это вышло только
 * случайно: префиксный запрос (а именно такой и шлёт поиск — {@code слово*})
 * падал с NPE внутри ArcadeDB.
 *
 * <p>Причина в логе БД: при переполнении FULL_TEXT-индекс выносит хвост в
 * под-индекс (<em>Creating sub-index 'KnowTaskHist_0_684104239038540(546)'</em>),
 * а {@code SEARCH_INDEX} по имени его не читает. Термовый запрос при этом
 * находит остаток и выглядит рабочим, а префиксный упирается в пустой
 * енумератор. За всю историю базы под-индексы создавались ровно у двух типов —
 * и это ровно два сломанных индекса.
 *
 * <p><b>Поэтому проверять «индекс есть» бесполезно.</b> Единственный надёжный
 * признак — поведенческий: взять слово ИЗ САМИХ ДАННЫХ и убедиться, что индекс
 * находит по нему хотя бы ту запись, из которой слово взято. Такая проверка не
 * зависит от размера корпуса и потому одинаково работает на тест-БД и на проде.
 *
 * <p>Класс намеренно НЕ валит старт и ничего не чинит: он отвечает на вопрос
 * «чему из выдачи поиска сегодня нельзя верить». Решение о пересоздании —
 * операторское, тем более что при переполнении пересоздание не помогает.
 */
@ApplicationScoped
public class LoreFtIndexHealth {

    private static final Logger LOG = Logger.getLogger(LoreFtIndexHealth.class);

    /** Заведомо отсутствующий префикс: на исправном индексе даёт 0, на битом — падает. */
    private static final String ABSENT_PREFIX = "zzqxvw*";

    @Inject
    LoreIngestService ingest;

    /**
     * Итог по одному индексу. {@code ok=false} означает «выдача поиска по этой
     * ветке неполна или пуста», а не «индекса нет».
     */
    public record Finding(String index, String type, boolean ok, String detail) {}

    /**
     * Проверяет все индексы реестра. Возвращает ТОЛЬКО непригодные — пустой
     * список значит «всем веткам поиска можно верить».
     */
    public List<Finding> check() {
        Set<String> types = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic("SELECT name FROM schema:types", Map.of())) {
            types.add(String.valueOf(r.get("name")));
        }
        List<Finding> bad = new ArrayList<>();
        for (LoreSchemaMigrations.FtIndex ix : LoreSchemaMigrations.FT_INDEXES) {
            if (!types.contains(ix.type())) continue;   // свежая БД — типа ещё нет
            Finding f = checkOne(ix);
            if (f != null && !f.ok()) bad.add(f);
        }
        if (!bad.isEmpty()) {
            LOG.errorf("[LORE FT] непригодных индексов: %d — поиск по этим веткам "
                + "отдаёт неполную выдачу, молча. Подробности: %s", bad.size(), bad);
        }
        return bad;
    }

    /** Одна проверка; {@code null} — проверить было не на чем (нет данных). */
    Finding checkOne(LoreSchemaMigrations.FtIndex ix) {
        String field = ix.fields().get(0);
        String word;
        try {
            word = probeWord(ix.type(), field);
        } catch (RuntimeException e) {
            return new Finding(ix.name(), ix.type(), false,
                "не прочитать данные для пробы: " + LoreUpstream.detail(e));
        }
        if (word == null) return null;   // поле всюду пустое — проверять нечего

        // 1. Слово из собственных данных обязано находиться. Ноль здесь — не
        //    «не нашлось», а «индекс не содержит того, что в нём должно быть».
        try {
            long hits = count(ix, word);
            if (hits == 0) {
                return new Finding(ix.name(), ix.type(), false,
                    "слово «" + word + "» взято из данных этого же типа, но индекс его не находит "
                    + "— индекс пуст или заполнен частично");
            }
        } catch (RuntimeException e) {
            return new Finding(ix.name(), ix.type(), false,
                "термовый запрос падает: " + LoreUpstream.detail(e));
        }

        // 2. Префиксный запрос — та форма, которой пользуется сам поиск
        //    («слово*»). На переполненном индексе она валится с NPE, тогда как
        //    термовая продолжает отвечать; без этой пробы дефект не виден.
        try {
            count(ix, ABSENT_PREFIX);
        } catch (RuntimeException e) {
            return new Finding(ix.name(), ix.type(), false,
                "префиксный запрос падает (признак выноса хвоста в под-индекс — "
                + "пересоздание такой индекс НЕ чинит): " + LoreUpstream.detail(e));
        }
        return new Finding(ix.name(), ix.type(), true, "");
    }

    /** Первое слово длиной ≥4 из непустого значения поля; {@code null} — данных нет. */
    private String probeWord(String type, String field) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT " + field + " AS v FROM " + type + " WHERE " + field + " IS NOT NULL LIMIT 20",
            Map.of());
        for (Map<String, Object> r : rows) {
            String v = String.valueOf(r.get("v"));
            for (String t : v.split("[^\\p{L}\\p{Nd}]+")) {
                // Кириллица и латиница одинаково допустимы; короткие слова
                // отбрасываем — они чаще оказываются стоп-словами анализатора
                // и «не нашлось» тогда означало бы не то, что мы проверяем.
                if (t.length() >= 4 && t.length() <= 20) return t.toLowerCase();
            }
        }
        return null;
    }

    private long count(LoreSchemaMigrations.FtIndex ix, String lucene) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT count(*) AS c FROM " + ix.type()
            + " WHERE SEARCH_INDEX('" + ix.name() + "', :q) = true",
            Map.of("q", lucene));
        if (rows.isEmpty()) return 0;
        Object c = rows.get(0).get("c");
        return c instanceof Number n ? n.longValue() : 0;
    }
}
