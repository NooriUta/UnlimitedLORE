package studio.seer.heimdall.lore;

import java.lang.reflect.Constructor;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-02 — запись реестра (Java record) ↔ JSON файла модели, по именам
 * компонент записи. Один кодек на все описания (поле, раздел, часть, вкладка, ребро, тип): формат
 * файла — ровно форма записей, второй схемы нет.
 *
 * <p>Пустое не пишется: {@code null}, {@code false} и пустой список в файле опускаются, а при чтении
 * восстанавливаются умолчанием по типу компоненты. Неизвестный ключ в файле — ошибка, а не тихий
 * пропуск: опечатка в имени поля иначе молча обнулила бы его значение.
 */
final class LoreModelCodec {

    private LoreModelCodec() {}

    /** Запись → карта (вложенные записи и списки — рекурсивно), пустое опущено. */
    static Object encode(Object v) {
        if (v == null) return null;
        if (v instanceof Record r) {
            Map<String, Object> m = new LinkedHashMap<>();
            for (RecordComponent c : r.getClass().getRecordComponents()) {
                Object x;
                try {
                    x = c.getAccessor().invoke(r);
                } catch (ReflectiveOperationException e) {
                    throw new IllegalStateException(e);
                }
                Object e = encode(x);
                if (e == null || Boolean.FALSE.equals(e) || (e instanceof List<?> l && l.isEmpty())) continue;
                m.put(c.getName(), e);
            }
            return m;
        }
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            for (Object o : l) out.add(encode(o));
            return out;
        }
        return v;
    }

    /** Карта файла → запись типа {@code cls}; {@code where} — путь в файле для текста ошибки. */
    @SuppressWarnings("unchecked")
    static <R extends Record> R decode(Class<R> cls, Object raw, String where) {
        if (!(raw instanceof Map<?, ?> m))
            throw new IllegalStateException(where + ": ждали объект " + cls.getSimpleName() + ", пришло " + kind(raw));
        RecordComponent[] comps = cls.getRecordComponents();
        java.util.Set<String> known = new java.util.HashSet<>();
        for (RecordComponent c : comps) known.add(c.getName());
        for (Object k : m.keySet())
            if (!known.contains(String.valueOf(k)))
                throw new IllegalStateException(where + ": неизвестный ключ «" + k + "» у " + cls.getSimpleName() + " (есть: " + known + ")");
        Object[] args = new Object[comps.length];
        Class<?>[] types = new Class<?>[comps.length];
        for (int i = 0; i < comps.length; i++) {
            RecordComponent c = comps[i];
            types[i] = c.getType();
            args[i] = value(c.getGenericType(), c.getType(), m.get(c.getName()), where + "." + c.getName());
        }
        try {
            Constructor<R> ctor = cls.getDeclaredConstructor(types);
            ctor.setAccessible(true);
            return ctor.newInstance(args);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(where + ": не собрать " + cls.getSimpleName() + ": " + e, e);
        }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Object value(Type generic, Class<?> type, Object raw, String where) {
        if (type == boolean.class) {
            if (raw == null) return false;
            if (raw instanceof Boolean b) return b;
            throw new IllegalStateException(where + ": ждали true/false, пришло " + kind(raw));
        }
        if (type == List.class) {
            if (raw == null) return List.of();
            if (!(raw instanceof List<?> l)) throw new IllegalStateException(where + ": ждали список, пришло " + kind(raw));
            Type item = generic instanceof ParameterizedType p ? p.getActualTypeArguments()[0] : Object.class;
            List<Object> out = new ArrayList<>();
            int i = 0;
            for (Object o : l) {
                String w = where + "[" + i++ + "]";
                if (item instanceof Class<?> ic && Record.class.isAssignableFrom(ic)) out.add(decode((Class) ic, o, w));
                else if (item == String.class) out.add(str(o, w));
                else out.add(o);
            }
            return List.copyOf(out);
        }
        if (raw == null) return null;
        if (Record.class.isAssignableFrom(type)) return decode((Class) type, raw, where);
        if (type == String.class) return str(raw, where);
        return raw;
    }

    private static String str(Object o, String where) {
        if (o instanceof String s) return s;
        throw new IllegalStateException(where + ": ждали строку, пришло " + kind(o));
    }

    private static String kind(Object o) {
        return o == null ? "null" : o.getClass().getSimpleName();
    }
}
