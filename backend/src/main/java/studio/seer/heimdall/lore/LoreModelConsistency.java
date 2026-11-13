package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-05 (SPEC-LORE-MODEL-CONFIG-STORE §4) — «модель ↔ схема ↔ срезы» для
 * ПРАВКИ модели: те же правила, что держит в CI сторож MC-03 (ModelServerConsistencyGuardTest), но
 * на сервере, до записи новой версии. Сторож проверяет файл репозитория, здесь — правку из админки:
 * одна функция на оба места, иначе правила разойдутся.
 *
 * <p>Что проверяется (структура и внутренние ссылки — уже в {@link LoreModelFile#check}):
 * <ol>
 *   <li>срезы, на которые ссылаются части паспорта и варианты полей, существуют;</li>
 *   <li>ребро каждой связи объявлено в схеме графа (опечатка в имени ребра — пустая вкладка навсегда);</li>
 *   <li>вид поля не противоречит объявленному типу свойства схемы; исключения — {@link #KIND_EXEMPT} с причиной;</li>
 *   <li>порядок разделов паспорта ссылается только на разделы, которые у типа есть.</li>
 * </ol>
 * Вкладка связи без своего среза читается по ребру всегда (LoreRecordValues#readByEdge), поэтому
 * отдельного правила «вкладка читается» здесь нет — его заменяет правило 2.
 */
final class LoreModelConsistency {

    private LoreModelConsistency() {}

    /** Вид поля, расходящийся с типом свойства схемы сознательно: тип.поле → причина. */
    static final Map<String, String> KIND_EXEMPT = Map.of();

    /**
     * @param schemaNames имена типов схемы графа (вершины и рёбра); {@code null} — схема не читалась,
     *                    правило 2 не проверено (и так и названо в ответе)
     * @param declared    объявленные типы свойств: тип вершины → свойство → тип схемы; {@code null} — не читались
     * @return причины отказа словами; пустой список — модель согласована
     */
    static List<String> problems(LoreModelFile.Content c, Set<String> schemaNames,
                                 Map<String, Map<String, String>> declared, java.util.function.Predicate<String> sliceExists) {
        List<String> out = new ArrayList<>();
        for (String t : c.types()) {
            LoreRecordRegistry.TypeDef d = c.typeDefs().get(t);
            for (LoreRecordRegistry.Part p : d.parts())
                if (p.slice() != null && !sliceExists.test(p.slice()))
                    out.add(t + ": часть «" + p.key() + "» читает срез «" + p.slice() + "», которого нет");
            for (LoreRecordRegistry.Field f : d.fields())
                if (f.options() != null && !sliceExists.test(f.options().slice()))
                    out.add(t + "." + f.key() + ": варианты из среза «" + f.options().slice() + "», которого нет");
            if (schemaNames != null)
                for (LoreRecordRegistry.Relation r : d.relations())
                    if (!schemaNames.contains(r.rel()))
                        out.add(t + "." + r.key() + ": ребра «" + r.rel() + "» в схеме графа нет");
            Set<String> sections = new LinkedHashSet<>();
            if (!d.body().isEmpty()) sections.add(LorePassportSurface.CONTENT);
            for (LoreRecordRegistry.Part p : d.parts()) sections.add(p.key());
            for (LoreRecordRegistry.Relation r : d.relations()) if ("link_tab".equals(r.place())) sections.add(r.key());
            for (LorePassportSurface.Slot s : c.passport().getOrDefault(t, List.of()))
                if (!sections.contains(s.key()))
                    out.add(t + ": порядок паспорта называет раздел «" + s.key() + "», которого у типа нет");
        }
        if (declared != null) out.addAll(kindDrift(c, declared));
        return out;
    }

    /** Вид поля против объявленного типа свойства (то же сопоставление полей, что у /lore/model). */
    static List<String> kindDrift(LoreModelFile.Content c, Map<String, Map<String, String>> declared) {
        List<String> out = new ArrayList<>();
        for (String t : c.types()) {
            LoreModelTypes.Graph g = c.graph().get(t);
            Map<String, String> types = new java.util.HashMap<>(declared.getOrDefault(g.vertex(), Map.of()));
            if (g.hist() != null) declared.getOrDefault(g.hist(), Map.of()).forEach(types::putIfAbsent);
            Map<String, String> aliases = c.aliases().getOrDefault(t, Map.of());
            for (LoreRecordRegistry.Field f : c.typeDefs().get(t).fields()) {
                String id = t + "." + f.key();
                if (KIND_EXEMPT.containsKey(id) || c.edgeFields().containsKey(id)) continue;
                String prop = aliases.getOrDefault(f.key(), f.write() != null && f.write().field() != null ? f.write().field() : f.key());
                String pt = types.get(prop);
                if (pt == null) pt = types.get(f.key());
                if (pt != null && !compatible(f.kind(), pt)) out.add(id + ": вид «" + f.kind() + "» против типа схемы " + pt);
            }
        }
        return out;
    }

    static boolean compatible(String kind, String schemaType) {
        Set<String> num = Set.of("INTEGER", "LONG", "SHORT", "BYTE", "FLOAT", "DOUBLE", "DECIMAL");
        return switch (kind == null ? "" : kind) {
            case "number", "days" -> num.contains(schemaType);
            case "date" -> Set.of("DATE", "DATETIME", "STRING").contains(schemaType);
            case "text", "md", "enum" -> "STRING".equals(schemaType);
            case "ref" -> Set.of("STRING", "LIST", "LINK", "LINKLIST").contains(schemaType);
            // MC-08: флаг — вид bool.
            case "bool" -> "BOOLEAN".equals(schemaType);
            default -> true;
        };
    }
}
