package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.HashMap;
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
 * <p>Причина — дефект движка: {@code CREATE INDEX ... FULL_TEXT} на типе с
 * данными отчитывается числом записей, но индексирует только те строки, что
 * записаны ПОСЛЕ создания индекса (ArcadeData/arcadedb#4732, закрыт по вехе
 * 26.7.1, на 26.7.2 воспроизводится). Термовый запрос находит этот остаток и
 * выглядит рабочим, префиксный падает с NPE.
 *
 * <p>Условие, при котором дефект срабатывает, НЕ УСТАНОВЛЕНО. На чистой базе той
 * же версии свежий тип собирается правильно во всех проверенных вариантах: 6000
 * строк, те же метаданные анализатора, строки с {@code NULL}, три круга
 * {@code UPDATE} всей таблицы с последующим {@code DELETE}, вершинный тип со
 * вторым индексом, 14.3 МБ текста (вчетверо больше пострадавшего типа) и ~180
 * тысяч разных термов. Ни объём, ни словарь, ни история обновлений сами по себе
 * дефект не воспроизводят — поэтому предсказать пострадавший индекс нельзя и
 * проверять приходится каждый.
 *
 * <p><b>Поэтому проверять «индекс есть» бесполезно.</b> Единственный надёжный
 * признак — поведенческий: взять слово ИЗ САМИХ ДАННЫХ и убедиться, что индекс
 * находит по нему хотя бы ту запись, из которой слово взято. Такая проверка не
 * зависит от размера корпуса и потому одинаково работает на тест-БД и на проде.
 *
 * <p>Класс намеренно НЕ валит старт и ничего не чинит: он отвечает на вопрос
 * «чему из выдачи поиска сегодня нельзя верить». Решение о пересоздании —
 * операторское, тем более что при этом дефекте пересоздание не помогает: на
 * проде оно оставило в индексе один документ из 6754.
 *
 * <p>С DBR-09 у вердикта появился второй потребитель: {@code LoreSearchResource}
 * спрашивает {@link #usable(String)} и, получив «нет», исполняет ветку сканом
 * вместо {@code SEARCH_INDEX}. Поэтому здесь есть кэш — иначе каждый запрос
 * поиска тянул бы за собой ~70 проб.
 */
@ApplicationScoped
public class LoreFtIndexHealth {

    private static final Logger LOG = Logger.getLogger(LoreFtIndexHealth.class);

    /** Заведомо отсутствующий префикс: на исправном индексе даёт 0, на битом — падает. */
    private static final String ABSENT_PREFIX = "zzqxvw*";

    /** Пригодность меняется только при DDL и перестройке — чаще проверять незачем. */
    private static final long TTL_MS = 10 * 60 * 1000L;

    /** Имя индекса → пригоден. Отсутствие ключа читается как «пригоден». */
    private volatile Map<String, Boolean> cache;
    private volatile long cachedAt;

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

    /**
     * Пригоден ли индекс — вердикт для ветки поиска (DBR-09).
     *
     * <p>Кэш обязателен: {@link #check()} делает по две-три пробы на индекс, и
     * без кэша каждый запрос поиска тянул бы ~70 запросов к БД. Пригодность
     * меняется только при DDL или перестройке индекса, так что TTL здесь — не
     * компромисс, а адекватная частота.
     *
     * <p><b>При отказе самой проверки возвращается {@code true}</b>, то есть
     * «идти через индекс, как раньше». Это осознанно противоположно правилу
     * {@code settingBool} из DBR-04, где неизвестность читается как «нельзя»:
     * там флаг что-то РАЗРЕШАЕТ, а здесь недоступность БД означала бы перевод
     * всех веток разом на скан — самый тяжёлый путь ровно в тот момент, когда
     * база и так не отвечает. Скан — лечение известной поломки индекса, а не
     * реакция на недоступность.
     */
    public boolean usable(String indexName) {
        if (indexName == null) return false;            // ветка и так живёт на скане
        Map<String, Boolean> snapshot = cache;
        if (snapshot == null || System.currentTimeMillis() - cachedAt > TTL_MS) {
            snapshot = refresh();
        }
        return snapshot.getOrDefault(indexName, true);
    }

    /** Сбросить кэш — после пересоздания индексов ждать TTL незачем. */
    public void invalidate() {
        cache = null;
    }

    private synchronized Map<String, Boolean> refresh() {
        // Второй поток мог обновить, пока этот ждал монитор.
        Map<String, Boolean> current = cache;
        if (current != null && System.currentTimeMillis() - cachedAt <= TTL_MS) return current;

        Map<String, Boolean> fresh = new HashMap<>();
        try {
            for (Finding f : check()) fresh.put(f.index(), false);
        } catch (RuntimeException e) {
            // Проверить не удалось — оставляем прежний вердикт, а если его не
            // было, пустая карта означает «всё пригодно» (см. javadoc usable).
            LOG.warnf("[LORE FT] пригодность индексов не проверена (%s) — ветки поиска "
                + "идут через индекс, как раньше", LoreUpstream.detail(e));
            return current == null ? Map.of() : current;
        }
        cache = fresh;
        cachedAt = System.currentTimeMillis();
        return fresh;
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
