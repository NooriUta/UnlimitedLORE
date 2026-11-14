package studio.seer.heimdall.lore.news;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * PU-29 (приёмка 14.11.2026): в ленте новостей автор-человек показывался сырым kc_sub.
 * Ответ ленты несёт {@code who_names}: имя из KnowUser по каждому значению «Кто» из строк
 * и из счёта фильтра {@code metrics.counts.by_who}. Значение фильтра остаётся прежним
 * (kc_sub или имя агента) — имя только подпись, поэтому ссылки и фильтры не ломаются.
 * Нет имени — значения нет в карте, клиент показывает ключ как раньше.
 */
public final class NewsWhoNames {

    private NewsWhoNames() {}

    /** Все значения «Кто» ответа, кроме заглушки «автор неизвестен». */
    public static Set<String> whos(Map<String, Object> response) {
        Set<String> out = new LinkedHashSet<>();
        if (response.get("events") instanceof List<?> evs)
            for (Object e : evs)
                if (e instanceof Map<?, ?> m && m.get("who") instanceof String w && !w.isBlank()) out.add(w);
        if (response.get("metrics") instanceof Map<?, ?> metrics
                && metrics.get("counts") instanceof Map<?, ?> counts
                && counts.get("by_who") instanceof Map<?, ?> byWho)
            for (Object k : byWho.keySet())
                if (k instanceof String w && !w.isBlank()) out.add(w);
        out.remove(NewsV2Engine.NOWHO);
        return out;
    }

    /** Кладёт в ответ {@code who_names} (пустую карту, если имён нет — «не нашли» ≠ «не искали»). */
    public static void attach(Map<String, Object> response, Map<String, String> names) {
        response.put("who_names", new TreeMap<>(names));
    }
}
