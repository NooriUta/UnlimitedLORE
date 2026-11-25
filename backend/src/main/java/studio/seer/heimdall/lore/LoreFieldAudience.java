package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE — видимость на уровне ПОЛЯ модели: тот же механизм audience, что у
 * раздела ({@link LoreModelNav#LEVELS}: everywhere | detail | admin | hidden), обобщён на поле
 * ({@code types[].fields[].audience}). Не задано — поле видно там же, где запись.
 *
 * <ul>
 *   <li>{@code admin} — поле отдаётся только admin/superadmin: из фасада записи (values, unmodeled, schema) и из
 *       срезов своего типа колонка вырезается сервером. Прятать в интерфейсе нельзя — спрятанное в UI поле видно в
 *       ответе (заметка задачи 22.11.2026).</li>
 *   <li>{@code hidden} — не отдаётся никому.</li>
 * </ul>
 *
 * <p>Срезы типа — главный срез паспорта ({@link LoreRecordResource#sourceOf}), срез списка раздела
 * ({@code surfaces.list}) и срезы вкладок, ведущих на тип ({@link LoreRecordFrom#SLICE_LINKS}). Срез, отдающий
 * такую колонку мимо этого списка, ловит сторож {@code LoreFieldAudienceTest}: либо тип, либо ADMIN_ONLY, либо
 * {@link #EXEMPT_SLICES} с причиной.
 */
final class LoreFieldAudience {

    private LoreFieldAudience() {}

    /**
     * Служебные срезы, которые отдают поле уровня admin не как поверхность записи. Каждая строка — открытая
     * дыра, видимая в коде (тот же приём, что SCOPE_PENDING): закрывать — решением, а не молча.
     */
    static final Map<String, String> EXEMPT_SLICES = Map.of(
        "machine_acl", "машины (актор minilore-link-*) — свой тип machine, не агент; срез решает видимость машин в miniLORE",
        "actor_identity_orphans", "отдаёт только акторов БЕЗ учётки (WHERE client_id пуст) — значения в колонке нет");

    /**
     * Служебные срезы, в которых поле уровня admin видит ещё и служебный читатель miniLORE (решение владельца
     * 25.11.2026, развилка 1б). agent_owners: сервер miniLORE (MachineOwners, WriterGate) отличает машину по префиксу
     * client_id «minilore-link-» и по ней решает, кому машина пишет. Его учётка — не admin, поэтому без этого
     * исключения машинам закрылась бы запись. Остальным вошедшим колонка не уходит.
     */
    static final Set<String> SERVICE_READER_SLICES = Set.of("agent_owners");

    /** Срез-поверхность типа сверх выведенных из модели: служебный срез агентов. */
    private static final Map<String, String> EXTRA_SLICE_TYPES = Map.of("agent_owners", "agent");

    /**
     * Служебный читатель miniLORE — клиент из {@code lore.scope.read-all-clients} (AL-91, тот же список и то же точное
     * совпадение, что дают ему чтение всего корпуса). Опознание по проверенному токену, не по заголовку.
     */
    static boolean serviceReader(String clientId, String readAllClients) {
        return AidaLoreResource.readsWholeCorpus(clientId, readAllClients);
    }

    static boolean isAdmin(String role) {
        return "admin".equals(role) || "superadmin".equals(role);
    }

    /** Уровень поля закрывает его от вызывающего с этой ролью. */
    static boolean closed(String level, String role) {
        if (level == null) return false;
        if ("hidden".equals(level)) return true;
        return "admin".equals(level) && !isAdmin(role);
    }

    /** Проверка модели: уровень поля — из тех же, что у раздела. */
    static List<String> problems(Map<String, LoreRecordRegistry.TypeDef> typeDefs) {
        List<String> out = new ArrayList<>();
        typeDefs.forEach((t, d) -> {
            for (LoreRecordRegistry.Field f : d.fields())
                if (f.audience() != null && !LoreModelNav.LEVELS.contains(f.audience()))
                    out.add(t + "." + f.key() + ": уровень видимости поля «" + f.audience() + "», есть " + LoreModelNav.LEVELS);
        });
        return out;
    }

    /** Ключи полей типа, закрытые от роли. */
    static Set<String> closedKeys(String type, String role) {
        LoreRecordRegistry.TypeDef d = type == null ? null : LoreModelFile.content().typeDefs().get(type);
        if (d == null) return Set.of();
        Set<String> out = new LinkedHashSet<>();
        for (LoreRecordRegistry.Field f : d.fields()) if (closed(f.audience(), role)) out.add(f.key());
        return out;
    }

    /** Колонки среза, из которых паспорт собирает поле: сам ключ и колонки-источники {@link LoreRecordFrom#VALUES}. */
    static Set<String> columnsOf(String type, String key) {
        Set<String> out = new LinkedHashSet<>();
        out.add(key);
        for (LoreRecordFrom.Val v : LoreRecordFrom.VALUES.getOrDefault(type, List.of()))
            if (v.key().equals(key)) out.addAll(v.from().columns());
        return out;
    }

    /**
     * Колонки, закрытые от роли. Колонка, из которой собирается ещё и открытое поле (запасная у FIRST_OF), не
     * вырезается: иначе пропало бы открытое значение.
     */
    static Set<String> closedColumns(String type, String role) {
        Set<String> keys = closedKeys(type, role);
        if (keys.isEmpty()) return Set.of();
        Set<String> out = new LinkedHashSet<>();
        for (String k : keys) out.addAll(columnsOf(type, k));
        for (LoreRecordFrom.Val v : LoreRecordFrom.VALUES.getOrDefault(type, List.of()))
            if (!keys.contains(v.key())) v.from().columns().forEach(out::remove);
        out.addAll(keys);
        return out;
    }

    private static volatile Map<String, String> sliceTypes;

    /** Тип записей, которые отдаёт срез; срез не поверхность типа — null. */
    static String typeOfSlice(String slice) {
        Map<String, String> m = sliceTypes;
        if (m == null) {
            m = new LinkedHashMap<>(EXTRA_SLICE_TYPES);
            for (String t : LoreRecordRegistry.TYPES) {
                LoreRecordResource.Source s = LoreRecordResource.sourceOf(t);
                if (s != null) m.putIfAbsent(s.slice(), t);
            }
            for (Map.Entry<String, LoreModelList.Spec> e : LoreModelFile.content().listSurface().entrySet())
                if (e.getValue().slice() != null) m.putIfAbsent(e.getValue().slice(), e.getKey());
            for (List<LoreRecordFrom.SliceLink> links : LoreRecordFrom.SLICE_LINKS.values())
                for (LoreRecordFrom.SliceLink sl : links) m.putIfAbsent(sl.slice(), sl.type());
            sliceTypes = m;
        }
        return m.get(slice);
    }

    /** Строки среза без закрытых от роли колонок; срез не поверхность типа или закрывать нечего — как есть. */
    static List<Map<String, Object>> stripRows(String slice, List<Map<String, Object>> rows, String role) {
        return stripRows(slice, rows, role, false);
    }

    /** То же; {@code serviceReader} — вызывающий служебный читатель miniLORE: служебные срезы ему отдаются целиком. */
    static List<Map<String, Object>> stripRows(String slice, List<Map<String, Object>> rows, String role, boolean serviceReader) {
        if (rows == null) return null;
        if (serviceReader && SERVICE_READER_SLICES.contains(slice)) return rows;
        Set<String> cols = closedColumns(typeOfSlice(slice), role);
        if (cols.isEmpty()) return rows;
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            if (r == null) { out.add(null); continue; }
            Map<String, Object> c = new LinkedHashMap<>(r);
            c.keySet().removeAll(cols);
            out.add(c);
        }
        return out;
    }

    /** Первый параметр (ось фасета, фильтр), который смотрит в закрытую колонку; нет — null. */
    static String closedParam(String slice, Collection<String> params, String role) {
        Set<String> cols = closedColumns(typeOfSlice(slice), role);
        for (String p : params) if (cols.contains(p)) return p;
        return null;
    }

    /** Фасад записи {@code lore.record/1}: закрытые поля уходят из values, unmodeled и схемы (поля и раскладка). */
    @SuppressWarnings("unchecked")
    static void stripRecord(String type, Map<String, Object> out, String role) {
        Set<String> keys = closedKeys(type, role);
        if (keys.isEmpty()) return;
        Set<String> cols = closedColumns(type, role);
        if (out.get("values") instanceof Map<?, ?> v) ((Map<String, Object>) v).keySet().removeAll(keys);
        if (out.get("unmodeled") instanceof Map<?, ?> u) {
            ((Map<String, Object>) u).keySet().removeAll(keys);
            ((Map<String, Object>) u).keySet().removeAll(cols);
        }
        if (out.get("schema") instanceof Map<?, ?> s) {
            Map<String, Object> schema = (Map<String, Object>) s;
            if (schema.get("fields") instanceof List<?> fl) {
                List<Object> kept = new ArrayList<>();
                for (Object f : fl) if (!(f instanceof Map<?, ?> fm && keys.contains(String.valueOf(fm.get("key"))))) kept.add(f);
                schema.put("fields", kept);
            }
            if (schema.get("layout") instanceof Map<?, ?> lay && lay.get("props") instanceof List<?> props)
                for (Object p : props)
                    if (p instanceof Map<?, ?> pm && pm.get("fields") instanceof List<?> pf) {
                        List<Object> kept = new ArrayList<>(pf);
                        kept.removeIf(x -> keys.contains(String.valueOf(x)));
                        ((Map<String, Object>) pm).put("fields", kept);
                    }
        }
    }
}
