package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Паспорт создания {@code _new} (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24) — раздел {@code create} модели.
 *
 * <p>Для типа: путь записи, имя поля кода в теле, поля формы по порядку и обязательное «одно из».
 * Поле с {@code body} уходит в тело создания под этим именем; поле без {@code body} пишется ПОСЛЕ
 * создания своим путём записи из модели типа ({@code write}) — так у спеки компонент, у которой связь
 * пишется фасадом паспорта.
 *
 * <p>Код записи вводит человек, а запись на сервере — upsert: занятый код молча переписал бы чужую
 * запись. Поэтому блок называет проверку «записи нет» — {@code absent_check}: 404 — код свободен,
 * 200 — занят (отказ), всё прочее — «не смогли проверить» (тоже отказ). Строгий 409 на сервере —
 * отдельная задача MT-MCP-TRUTH.
 */
final class LoreModelCreate {

    private LoreModelCreate() {}

    /** Поле формы создания: ключ поля типа и имя в теле записи (null — пишется после создания своим write). */
    record Field(String key, String body) {}

    /** Создание типа: путь, поле кода в теле, поля формы, обязательное «хотя бы одно из». */
    record Spec(String endpoint, String id_field, List<Field> fields, List<String> require_one_of) {}

    /** Согласованность раздела с типами модели — сообщения словами, пусто = согласовано. */
    static List<String> problems(Map<String, Spec> create, Map<String, LoreRecordRegistry.TypeDef> types) {
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, Spec> e : create.entrySet()) {
            String t = e.getKey();
            Spec s = e.getValue();
            LoreRecordRegistry.TypeDef d = types.get(t);
            if (d == null) { out.add("create." + t + ": неизвестный тип"); continue; }
            if (s.endpoint() == null || !s.endpoint().startsWith("/lore/")) out.add("create." + t + ": путь записи не /lore/…");
            if (s.id_field() == null || s.id_field().isBlank()) out.add("create." + t + ": нет id_field");
            List<String> keys = new ArrayList<>();
            for (Field f : s.fields()) {
                keys.add(f.key());
                LoreRecordRegistry.Field mf = d.field(f.key());
                if (mf == null) { out.add("create." + t + ": поля «" + f.key() + "» у типа нет"); continue; }
                if (f.body() == null && mf.write() == null)
                    out.add("create." + t + "." + f.key() + ": нет body и у поля нет своего пути записи — значение пропадёт");
            }
            for (String k : s.require_one_of())
                if (!keys.contains(k)) out.add("create." + t + ": require_one_of «" + k + "» не среди полей формы");
        }
        return out;
    }

    /** Блок {@code create} паспорта {@code _new} и типа в /lore/model; null — путей создания у типа нет. */
    static Map<String, Object> block(String type) {
        LoreModelFile.Content c = LoreModelFile.content();
        Spec s = c.create().get(type);
        if (s == null) return null;
        LoreRecordRegistry.TypeDef d = c.typeDefs().get(type);
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("endpoint", s.endpoint());
        b.put("id_field", s.id_field());
        List<Map<String, Object>> fields = new ArrayList<>();
        for (Field f : s.fields()) {
            LoreRecordRegistry.Field mf = d.field(f.key());
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", f.key());
            m.put("label", mf.label());
            m.put("kind", mf.kind());
            if (mf.refType() != null) m.put("ref_type", mf.refType());
            m.put("multi", mf.multi());
            m.put("body", f.body());
            // без body — пишется после создания своим путём записи
            m.put("after_write", f.body() == null ? LoreModelCodec.encode(mf.write()) : null);
            m.put("required", mf.required() || s.require_one_of().size() == 1 && s.require_one_of().contains(f.key()));
            fields.add(m);
        }
        b.put("fields", fields);
        b.put("require_one_of", s.require_one_of());
        b.put("absent_check", "/lore/record/" + type + "/{id}");
        b.put("audience", c.audience().getOrDefault(type, "everywhere"));
        return b;
    }
}
