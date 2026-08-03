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
     * @param finding  тип находки (job_claimed_not_performed и т.п.)
     * @param refId    корень
     * @param missingId что именно не доставлено
     */
    record Gap(String finding, String refId, String title, String missingId) {}

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
        List<Gap> gaps = new ArrayList<>();
        if (analyticsRows == null) return gaps;

        for (Map<String, Object> r : analyticsRows) {
            String ref   = String.valueOf(r.get("uc_id"));
            String title = r.get("title") == null ? null : String.valueOf(r.get("title"));

            diff(gaps, "job_claimed_not_performed", ref, title,
                asSet(r.get("claimed_job_ids")), asSet(r.get("performed_job_ids")));

            diff(gaps, "pain_claimed_not_relieved", ref, title,
                asSet(r.get("claimed_pain_ids")), asSet(r.get("relieved_pain_ids")));

            // Именно measured: выгода без метрики fit не замыкает (ADR-032 §2).
            diff(gaps, "gain_claimed_not_delivered", ref, title,
                asSet(r.get("claimed_gain_ids")), asSet(r.get("delivered_measured_gain_ids")));

            // Обратная сторона: доставлено то, чего корень не заявлял. Это не
            // ошибка, но и не норма — либо забыли заявку, либо сценарий делает
            // не то, ради чего заведён. Молчать о таком значит терять сигнал.
            diff(gaps, "gain_delivered_not_claimed", ref, title,
                asSet(r.get("delivered_measured_gain_ids")), asSet(r.get("claimed_gain_ids")));
        }
        return gaps;
    }

    private static void diff(List<Gap> out, String finding, String ref, String title,
                             Set<String> claimed, Set<String> delivered) {
        for (String id : claimed) {
            if (!delivered.contains(id)) out.add(new Gap(finding, ref, title, id));
        }
    }
}
