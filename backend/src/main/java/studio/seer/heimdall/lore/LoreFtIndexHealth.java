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

    /**
     * Индексы, по которым вердикта НЕТ: на момент проверки тип был пуст, и
     * {@link #checkOne} честно вернул {@code null} — «проверять было не на чем».
     *
     * <p><b>Зачем отдельное множество.</b> Без него «не на чем проверить»
     * сливалось с «пригоден»: {@link #check()} собирает только ПЛОХИЕ находки,
     * а {@link #usable} на отсутствие ключа отвечает «да». Вердикт, взятый на
     * пустом типе, жил дальше десять минут TTL — и всё, что записали в это
     * окно, искалось через индекс, который тогда ещё нечем было проверить.
     *
     * <p>Именно это уронило CI 10–11.09: на свежей тест-БД проверка проходила
     * по пустым типам, ответ «пригоден» кэшировался, тест создавал запись и
     * тут же искал её — поиск шёл в индекс и возвращал ПУСТО, а страховка
     * (ветка сканом) не срабатывала, потому что индекс числился исправным.
     * Симптом в тесте выглядел как {@code Actual: null}, то есть «записи нет»,
     * хотя запись создалась и лежит в базе.
     *
     * <p>Замерено на оставшейся тест-БД {@code lore_ci_test}:
     * {@code SEARCH_INDEX('ftKnowUseCase','Merge')} → 0, при том что
     * {@code title LIKE '%Merge%'} → 1.
     *
     * <p>Это тот же класс, что «пустой ответ ≠ не найдено», только внутри
     * самой проверки: непроведённая проверка выглядела как успешная.
     */
    private volatile Set<String> undetermined = Set.of();

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
        List<Finding> bad = new ArrayList<>();
        for (Finding f : checkAll().values()) {
            if (f != null && !f.ok()) bad.add(f);
        }
        if (!bad.isEmpty()) {
            LOG.errorf("[LORE FT] непригодных индексов: %d — поиск по этим веткам "
                + "отдаёт неполную выдачу, молча. Подробности: %s", bad.size(), bad);
        }
        return bad;
    }

    /**
     * Вердикт по КАЖДОМУ индексу реестра, включая {@code null} — «проверять
     * было не на чем, тип пуст».
     *
     * <p>Отдельный метод нужен потому, что {@link #check()} по своему договору
     * отдаёт только плохие находки, и на его выдаче «не на чем проверить»
     * неотличимо от «пригоден». Разницу обязан видеть кэш: первое надо
     * перепроверить, как только в типе появятся данные, второе — нет.
     */
    Map<String, Finding> checkAll() {
        Set<String> types = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic("SELECT name FROM schema:types", Map.of())) {
            types.add(String.valueOf(r.get("name")));
        }
        Map<String, Finding> all = new HashMap<>();
        for (LoreSchemaMigrations.FtIndex ix : LoreSchemaMigrations.FT_INDEXES) {
            if (!types.contains(ix.type())) continue;   // свежая БД — типа ещё нет
            all.put(ix.name(), checkOne(ix));           // значение null — тип пуст
        }
        return all;
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
        // Вердикт, взятый на ПУСТОМ типе, кэшировать нельзя: данные появляются
        // в любой момент, а срок жизни кэша — десять минут. Перепроверяем такой
        // индекс адресно, одной-двумя пробами, и только когда данные появились,
        // записываем настоящий вердикт.
        if (undetermined.contains(indexName)) return recheckUndetermined(indexName);
        return snapshot.getOrDefault(indexName, true);
    }

    /**
     * Перепроверить индекс, по которому вердикта не было.
     *
     * <p>Тип всё ещё пуст — отвечаем «пригоден»: искать в нём нечего, и ветка
     * через индекс вернёт пусто ровно так же, как вернул бы скан. Данные
     * появились — считаем настоящий вердикт, кладём в кэш и снимаем индекс с
     * перепроверки, чтобы не платить пробами на каждый запрос.
     *
     * <p>Проба не удалась — отвечаем «НЕ пригоден», то есть уводим ветку на
     * скан. Здесь это безопасная сторона: скан отдаёт полную выдачу, теряется
     * только ранжирование, тогда как ошибка в другую сторону отдаёт МОЛЧА
     * неполную. Ровно из-за неё и написан этот метод.
     */
    private boolean recheckUndetermined(String indexName) {
        LoreSchemaMigrations.FtIndex ix = LoreSchemaMigrations.FT_INDEXES.stream()
            .filter(i -> i.name().equals(indexName)).findFirst().orElse(null);
        if (ix == null) return true;                    // индекса нет в реестре — не наше дело
        Finding f;
        try {
            f = checkOne(ix);
        } catch (RuntimeException e) {
            LOG.warnf("[LORE FT] %s: перепроверка не удалась (%s) — ветка идёт сканом",
                indexName, LoreUpstream.detail(e));
            return false;
        }
        if (f == null) return true;                     // тип всё ещё пуст — искать нечего
        synchronized (this) {
            Map<String, Boolean> next = new HashMap<>(cache == null ? Map.of() : cache);
            if (!f.ok()) next.put(indexName, false);
            cache = next;
            Set<String> rest = new HashSet<>(undetermined);
            rest.remove(indexName);
            undetermined = Set.copyOf(rest);
        }
        if (!f.ok()) {
            LOG.errorf("[LORE FT] %s признан непригодным при первой же записи в тип: %s",
                indexName, f.detail());
        }
        return f.ok();
    }

    /** Сбросить кэш — после пересоздания индексов ждать TTL незачем. */
    public void invalidate() {
        cache = null;
        // Список «без вердикта» — часть того же снимка: оставить его значило бы
        // перепроверять по устаревшему списку индексы, которые уже пересобраны.
        undetermined = Set.of();
    }

    private synchronized Map<String, Boolean> refresh() {
        // Второй поток мог обновить, пока этот ждал монитор.
        Map<String, Boolean> current = cache;
        if (current != null && System.currentTimeMillis() - cachedAt <= TTL_MS) return current;

        Map<String, Boolean> fresh = new HashMap<>();
        try {
            Set<String> undet = new HashSet<>();
            for (Map.Entry<String, Finding> e : checkAll().entrySet()) {
                if (e.getValue() == null) undet.add(e.getKey());          // проверять было не на чем
                else if (!e.getValue().ok()) fresh.put(e.getKey(), false);
            }
            undetermined = Set.copyOf(undet);
            if (!undet.isEmpty()) {
                LOG.infof("[LORE FT] без вердикта (тип пуст): %d — эти индексы будут "
                    + "перепроверены, как только в типе появятся данные: %s", undet.size(), undet);
            }
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
