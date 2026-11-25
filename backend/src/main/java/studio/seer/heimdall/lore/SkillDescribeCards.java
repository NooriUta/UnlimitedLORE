package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-04 · describe-карточки видов tag:* и skill:* (SPEC-SKILLS-TAGS-062 §9) по
 * форме SPEC-AGENT-SURFACE-061 §8: params, enums, identities, links, guards, errors с рецептами.
 *
 * <p>Закрывает дыру паритета SPEC-MCP-SURFACE-056: до этого виды тегов и скиллов не описывал никто — агент
 * узнавал гарды только отказом. Источник значений — те же константы, что у гардов записи ({@link SkillRules}),
 * поэтому карточка и поведение не расходятся. Генератор карточек из KnowRegistry (KREG-07) сможет брать
 * эти карточки как есть; до него их отдаёт {@code GET /lore/skill/describe}.
 */
final class SkillDescribeCards {

    private SkillDescribeCards() {}

    static final List<String> KINDS = List.of("skill:*", "tag:*");

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    /** Карточка вида; {@code skill:<slug>} → карточка skill:*, {@code tag:<slug>} → tag:*; чужое — {@code null}. */
    static Map<String, Object> card(String kind) {
        if (kind == null) return null;
        String k = kind.strip();
        if (k.equals("skill:*") || (k.startsWith("skill:") && SkillRules.geoid(k) != null)) return skill(k);
        if (k.startsWith("tag:")) return tag(k);
        return null;
    }

    private static Map<String, Object> skill(String kind) {
        return m(
            "kind", kind,
            "title", "Навык роли: процедура «как делать» (KnowSkill)",
            "id_field", "skill_id (skill:<slug>)",
            "params", List.of(
                m("name", "skill_id", "type", "string", "required", true, "format", "skill:<slug>, kebab-case"),
                m("name", "title", "type", "string", "required", true),
                m("name", "body_md", "type", "md", "required", true, "desc", "шаги, ограничения, примеры, ссылки"),
                m("name", "projects", "type", "string[]", "required", true, "min", 1, "edge", "BELONGS_TO_PROJECT"),
                m("name", "roles", "type", "enum[]", "enum_ref", "dict:agent_profile", "required", true, "min", 1, "edge", "APPLIES_TO_ROLE"),
                m("name", "status", "type", "enum", "enum_ref", "dict:skill_status", "required", false, "default", "draft"),
                m("name", "version", "type", "semver", "required", false),
                m("name", "source", "type", "enum", "required", false),
                m("name", "owner", "type", "ref", "ref", "KnowUser (kc_sub | login)", "required", false, "edge", "OWNED_BY"),
                m("name", "extends_ids", "type", "string[]", "required", false, "edge", "SKILL_EXTENDS")),
            "read", List.of(
                m("slice", "skills", "params", List.of("project", "role", "status"), "body_md", false),
                m("slice", "skills_full", "params", List.of("project", "role", "status"), "body_md", true)),
            "enums", m("skill_status", SkillRules.STATUSES, "source", SkillRules.SOURCES),
            "identities", SkillRules.WRITERS,
            "links", List.of(
                m("rel", "project", "edge", "BELONGS_TO_PROJECT", "to", "KnowGitProject", "min", 1),
                m("rel", "role", "edge", "APPLIES_TO_ROLE", "to", "KnowDictEntry agent_profile", "min", 1),
                m("rel", "extends", "edge", "SKILL_EXTENDS", "to", "KnowSkill", "acyclic", true),
                m("rel", "owner", "edge", "OWNED_BY", "to", "KnowUser", "max", 1)),
            "guards", List.of(
                m("name", "required-edges", "params", SkillRules.REQUIRED_EDGES),
                m("name", "no-extends-cycle"),
                m("name", "no-dangling-unlink", "params", List.of("последний BELONGS_TO_PROJECT / APPLIES_TO_ROLE не снимается")),
                m("name", "status-moves", "params", List.of("создание → draft", "draft → active | deprecated",
                    "active → deprecated", "deprecated → active: owner only"))),
            "errors", List.of(
                m("code", "REFUSED", "when", "нет обязательных рёбер, цикл EXTENDS или снятие последнего обязательного ребра",
                    "next", "добавить рёбра / разорвать цикл / сначала добавить замену"),
                m("code", "NOOP", "when", "deprecated → active не владельцем", "next", "запросить активацию у owner (OWNED_BY)"),
                m("code", "BAD_TRANSITION", "when", "смена статуса не по жизненному циклу", "next", "см. guards.status-moves"),
                m("code", "FORBIDDEN_FOR_ROLE", "when", "запись не full/architect", "hint", "переложить правку на full или architect")),
            "write", List.of(
                m("tool", "entity_upsert", "type", "skill", "path", "/lore/skill"),
                m("tool", "entity_link", "type", "skill", "path", "/lore/skill/link")));
    }

    private static Map<String, Object> tag(String kind) {
        return m(
            "kind", kind,
            "title", "Супертег: тег со свободными полями на ребре (KnowTag)",
            "id_field", "tag_id (tag:<slug>)",
            "params", List.of(
                m("name", "tag_id", "type", "string", "required", true, "format", "tag:<slug>"),
                m("name", "name", "type", "string", "required", true, "desc", "токен #имя"),
                m("name", "title", "type", "string", "required", true),
                m("name", "field_schema", "type", "map", "required", false, "desc", "подсказка полей, не DDL"),
                m("name", "synonyms", "type", "string[]", "required", false, "desc", "бывшие имена (rename)"),
                m("name", "source", "type", "enum", "required", true),
                m("name", "fields", "type", "map", "required", false, "desc", "значения на ребре TAGGED_WITH; null снимает поле")),
            "read", List.of(
                m("slice", "tag_entities", "params", List.of("tag")),
                m("slice", "tags_usage", "params", List.of())),
            "enums", m("source", SkillRules.SOURCES),
            "identities", List.of("full", "architect", "developer"),
            "links", List.of(m("rel", "tag", "edge", "TAGGED_WITH", "from", "ADR, решение", "attrs", "свободные поля тега")),
            "guards", List.of(
                m("name", "rename-rewrites-bodies", "params", List.of("[[GEOID#тег]] переписываются, бывшее имя → synonyms")),
                m("name", "broken-ref-invariant", "params", List.of("токен без вершины тега = 0 (QG qg-lore-skill-tag)"))),
            "errors", List.of(
                m("code", "partial_failure", "when", "rename оставил несопоставленные токены",
                    "next", "разобрать отчёт: синоним в KnowTag или ручная перезапись тела"),
                m("code", "TAG_TAKEN", "when", "новое имя тега уже занято", "next", "выбрать другое имя или слить теги"),
                m("code", "FORBIDDEN_FOR_ROLE", "when", "запись не из allowed", "hint", "full, architect или developer")),
            "write", List.of(
                m("tool", "entity_link", "rel", "tag", "path", "/lore/tag/apply"),
                m("path", "/lore/tag/rename")));
    }
}
