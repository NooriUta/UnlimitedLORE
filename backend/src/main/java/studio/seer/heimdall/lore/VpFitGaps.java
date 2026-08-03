package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Разрыв «заявлено против доставлено» по трём осям VP-канвы — ЧИСТАЯ логика,
 * без БД и HTTP.
 *
 * <p><b>Зачем понадобилось.</b> Срез {@code feature_vp_analytics} отдаёт СЫРЫЕ
 * множества (claimed_* и delivered_*), а разницу считает потребитель — тот же
 * приём, что у {@code invest_profile}, и по той же причине: GROUP BY на этой
 * версии ArcadeDB молча группирует неверно. Приём верный, но у него оказалось
 * следствие, которого не предвидели: **разницу не считал никто**. Ни один
 * клиент, ни MCP.
 *
 * <p>Цена выяснилась на самой канве. {@code FEAT-VP-FIT} — фича, существующая
 * ровно ради ловли этого разрыва, — стояла со статусом {@code shipped} и
 * ПУСТЫМИ всеми тремя осями доставки: заявлена работа, боль и выгода,
 * доставлено ничего. Обнаружено это было глазами, сверкой шести массивов, а не
 * системой. Дыра прожила 11 дней с момента заведения фичи.
 *
 * <p><b>Почему разница считается здесь, а не в SQL.</b> Разность множеств
 * потребовала бы UNWIND, которого в кодовой базе нет ни разу, а грамматика
 * 26.7.2 уже трижды подводила на конструкциях, выглядевших очевидными
 * ({@code @depth} в TRAVERSE, {@code .@class}, {@code DELETE EDGE}). Java-разница
 * поверх готового среза — тот же контракт «сырые факты из БД, агрегация выше»,
 * только выполненный ОДИН раз на сервере, а не оставленный каждому клиенту.
 *
 * <p><b>Что считается закрытием оси.</b> Заявка живёт на КОРНЕ (HELPS_WITH /
 * ADDRESSES / PROMISES), доставка — на его СЦЕНАРИЯХ (PERFORMS / RELIEVES /
 * DELIVERS). Это разные утверждения, и разрыв между ними — предмет этого
 * класса. Для выгод закрытием считается только доставка С МЕТРИКОЙ
 * ({@code delivered_measured_gain_ids}): выгода без измеримой метрики не
 * замыкает fit по ADR-LORE-032 §2, и засчитывать её значило бы прятать ровно то,
 * ради чего метрика введена.
 */
final class VpFitGaps {

    private VpFitGaps() {}

    /**
     * Одна дыра: корень заявил, но ни один его сценарий не доставляет.
     *
     * @param finding   тип находки (job_claimed_not_performed и т.п.)
     * @param refId     корень
     * @param missingId что именно не доставлено
     * @param weight    ранг выгоды / важность боли; null — вес неизвестен
     * @param essential существенна ли дыра — по ней сортируется выдача
     */
    record Gap(String finding, String refId, String title, String missingId,
               String weight, boolean essential) {}

    /**
     * Веса, при которых дыра считается существенной (MT-04).
     *
     * <p>Ранги заведены и заполняются, но до этой правки в разрыв не входили:
     * незакрытая {@code essential}-выгода и незакрытая {@code unexpected} были
     * двумя одинаковыми строками. При десятке дыр это ещё читается глазами; при
     * полусотне отчёт превращается в список, из которого не выбрать, за что
     * браться, — и им перестают пользоваться. Не использовать ранги в главном
     * отчёте по fit значит обесценить их заполнение.
     *
     * <p>{@code expected} включён намеренно: по Остервальдеру это то, что
     * клиент считает само собой разумеющимся, и его отсутствие замечают так же
     * быстро, как отсутствие обязательного.
     */
    private static final Set<String> ESSENTIAL_WEIGHTS = Set.of("essential", "expected", "high");

    /** Траверс отдаёт скаляр, список или null — приводим к множеству строк. */
    static Set<String> asSet(Object raw) {
        Set<String> out = new LinkedHashSet<>();
        if (raw instanceof Collection<?> c) {
            for (Object o : c) if (o != null && !String.valueOf(o).isBlank()) out.add(String.valueOf(o));
        } else if (raw != null && !String.valueOf(raw).isBlank()) {
            out.add(String.valueOf(raw));
        }
        return out;
    }

    /**
     * Строки среза {@code feature_vp_analytics} → список дыр.
     *
     * <p>Порядок осей в выдаче — работы, боли, выгоды — совпадает с порядком
     * столпов канвы Остервальдера, чтобы отчёт читался как канва, а не как
     * произвольный список.
     */
    static List<Gap> evaluate(List<Map<String, Object>> analyticsRows) {
        return evaluate(analyticsRows, Map.of(), Map.of());
    }

    /**
     * @param gainRanks      gain_id → rank (essential|expected|desired|unexpected)
     * @param painSeverities pain_id → severity (high|normal|low)
     */
    static List<Gap> evaluate(List<Map<String, Object>> analyticsRows,
                              Map<String, String> gainRanks,
                              Map<String, String> painSeverities) {
        List<Gap> gaps = new ArrayList<>();
        if (analyticsRows == null) return gaps;

        for (Map<String, Object> r : analyticsRows) {
            String ref   = String.valueOf(r.get("uc_id"));
            String title = r.get("title") == null ? null : String.valueOf(r.get("title"));

            // У работ своей шкалы веса в разрыве нет: importance живёт на самой
            // работе, но невыполненная работа существенна всегда — если её никто
            // не выполняет, линия не делает того, ради чего заявлена.
            diff(gaps, "job_claimed_not_performed", ref, title,
                asSet(r.get("claimed_job_ids")), asSet(r.get("performed_job_ids")),
                Map.of(), true);

            diff(gaps, "pain_claimed_not_relieved", ref, title,
                asSet(r.get("claimed_pain_ids")), asSet(r.get("relieved_pain_ids")),
                painSeverities, false);

            // Именно measured: выгода без метрики fit не замыкает (ADR-032 §2).
            diff(gaps, "gain_claimed_not_delivered", ref, title,
                asSet(r.get("claimed_gain_ids")), asSet(r.get("delivered_measured_gain_ids")),
                gainRanks, false);

            // Обратная сторона: доставлено то, чего корень не заявлял. Это не
            // ошибка, но и не норма — либо забыли заявку, либо сценарий делает
            // не то, ради чего заведён. Молчать о таком значит терять сигнал.
            // Существенной такая находка не бывает: доставленное лишнее не
            // ломает обещание, в отличие от недоставленного заявленного.
            diff(gaps, "gain_delivered_not_claimed", ref, title,
                asSet(r.get("delivered_measured_gain_ids")), asSet(r.get("claimed_gain_ids")),
                gainRanks, false);
        }

        // Существенные — наверх. Порядок внутри групп сохраняется стабильным:
        // список, меняющий порядок между вызовами, нельзя сравнить с прошлым.
        gaps.sort((a, b) -> Boolean.compare(b.essential(), a.essential()));
        return gaps;
    }

    /**
     * Покрытие INVEST-профиля (MT-02): на какой доле корпуса он вообще посчитан.
     *
     * <p><b>Зачем.</b> Срез {@code invest_profile} показывает баланс «ценность
     * против расчистки» по классам {@code uc}/{@code jtd}/{@code enb}. Замер
     * 2026-08-03: класс задан у 256 задач из 3267, и на них приходится 71 день
     * из 3061 — то есть баланс строится на <b>2.3% трудоёмкости</b>.
     *
     * <p>Само по себе это не дефект: {@code work_class} законно бывает пустым
     * (ADR-LORE-022 D3). Дефект в том, что размер выборки нигде не виден, а
     * рядом стоит здоровая цифра «оценка проставлена у 85.6% задач» — и она
     * усиливает обман: смотрящий видит хорошее покрытие ОЦЕНКАМИ и не
     * догадывается, что покрытие КЛАССАМИ на порядок меньше.
     *
     * <p>Числа возвращаются сырыми, доли — считанными: округление и формат
     * оставлены потребителю, а деление на ноль на пустом корпусе не должно
     * решаться каждым клиентом заново.
     */
    record InvestCoverage(int tasksTotal, int tasksClassified,
                          double effortTotal, double effortClassified,
                          double taskShare, double effortShare) {}

    static InvestCoverage coverage(List<Map<String, Object>> investRows) {
        int total = 0, classified = 0;
        double effTotal = 0, effClassified = 0;
        if (investRows != null) {
            for (Map<String, Object> r : investRows) {
                total++;
                Object wc = r.get("work_class");
                boolean hasClass = wc != null && !String.valueOf(wc).isBlank();
                if (hasClass) classified++;
                Object eff = r.get("effort_days");
                if (eff instanceof Number n) {
                    effTotal += n.doubleValue();
                    if (hasClass) effClassified += n.doubleValue();
                }
            }
        }
        return new InvestCoverage(total, classified, effTotal, effClassified,
            total == 0 ? 0 : (double) classified / total,
            effTotal == 0 ? 0 : effClassified / effTotal);
    }

    private static void diff(List<Gap> out, String finding, String ref, String title,
                             Set<String> claimed, Set<String> delivered,
                             Map<String, String> weights, boolean alwaysEssential) {
        for (String id : claimed) {
            if (delivered.contains(id)) continue;
            String w = weights.get(id);
            boolean essential = alwaysEssential
                || (w != null && ESSENTIAL_WEIGHTS.contains(w));
            out.add(new Gap(finding, ref, title, id, w, essential));
        }
    }
}
