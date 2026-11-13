package studio.seer.heimdall.lore;

import java.util.AbstractList;
import java.util.AbstractMap;
import java.util.AbstractSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-05 (SPEC-LORE-MODEL-CONFIG-STORE §3) — неизменяемые представления,
 * которые на каждое обращение читают ТЕКУЩУЮ модель. Статические поля реестра ({@code TYPES},
 * {@code GRAPH}, …) остаются полями — потребители их не меняют, — но правка модели видна им сразу,
 * без перезагрузки класса и рестарта сервера.
 */
final class LoreModelViews {

    private LoreModelViews() {}

    static <T> List<T> list(Supplier<List<T>> src) {
        return new AbstractList<>() {
            @Override public T get(int i) { return src.get().get(i); }
            @Override public int size() { return src.get().size(); }
        };
    }

    static <T> Set<T> set(Supplier<Set<T>> src) {
        return new AbstractSet<>() {
            @Override public Iterator<T> iterator() { return java.util.Collections.unmodifiableSet(src.get()).iterator(); }
            @Override public int size() { return src.get().size(); }
            @Override public boolean contains(Object o) { return src.get().contains(o); }
        };
    }

    static <K, V> Map<K, V> map(Supplier<Map<K, V>> src) {
        return new AbstractMap<>() {
            @Override public Set<Entry<K, V>> entrySet() { return java.util.Collections.unmodifiableMap(src.get()).entrySet(); }
            @Override public V get(Object k) { return src.get().get(k); }
            @Override public boolean containsKey(Object k) { return src.get().containsKey(k); }
            @Override public int size() { return src.get().size(); }
        };
    }
}
