package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK · spec:SPEC-LORE-MD-INLINE-REF §7 —
 * чистая часть автосвязей по упоминаниям в MD-телах (без БД).
 *
 * <p><b>Разбор</b> — те же формы, что у фронта: {@code kit/src/content/markdownWiki.ts}
 * ({@code [[…]]} до 200 символов без скобок и перевода строки, {@code тип:} —
 * латиница {@code [a-z]+}, тип в нижний регистр, обе части с trim) и
 * {@code web-next/src/record/loreRefForms.ts} (тип по форме ID, когда он не задан).
 * Внутри кода ссылка не считается: inline-код и огороженные блоки ({@code ```},
 * {@code ~~~}) вырезаются до разбора. Расхождение (известное): блок кода отступом в
 * 4 пробела здесь не вырезается — у marked он код; на телах LORE не встречается.
 *
 * <p><b>Решение.</b> Ребро ставится, только если для пары ровно одно
 * типизированное ребро (в любом направлении) И эта пара помечена в
 * {@link LoreLinkTypes#AUTO_PAIRS}. Иначе — {@link Skip} с причиной; такие
 * упоминания остаются в панели «упоминания без связи» (S2-06), человек выбирает сам.
 */
final class LoreMentionAutoLink {

    private LoreMentionAutoLink() {}

    /** Провенанс авто-ребра — отличим от {@code origin='mention'} ручного «Связать». */
    static final String ORIGIN = "mention-auto";

    /** {@code raw} — как в тексте; {@code type} — тип каталога или null (форма не узнана). */
    record Ref(String raw, String type, String id) {}

    sealed interface Decision permits Plan, Skip { Ref ref(); }

    /** Поставить {@code option} между {@code fromId → toId} (концы — в направлении ребра). */
    record Plan(Ref ref, LoreLinkTypes.Option option, String fromId, String toId) implements Decision {
        String fromType() { return option.fromType(); }
        String toType() { return option.toType(); }
    }

    record Skip(Ref ref, String reason) implements Decision {}

    private static final Pattern WIKI = Pattern.compile("\\[\\[([^\\[\\]\\n]{1,200})\\]\\]");
    private static final Pattern TYPED = Pattern.compile("^([a-z]+):(.+)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern FENCE_OPEN = Pattern.compile("^ {0,3}(`{3,}|~{3,})");
    private static final Pattern CODE_SPAN = Pattern.compile("(`+)(?!`)([\\s\\S]*?[^`])\\1(?!`)");

    /** Синонимы типа в теле → тип каталога (как WORDS в loreMdRefs.tsx, только латиница). */
    private static final Map<String, String> ALIASES = Map.of("uc", "use_case");

    /** Тип по форме ID — копия typeByForm из web-next/src/record/loreRefForms.ts. */
    static String typeByForm(String id) {
        if (id == null) return null;
        if (id.matches("(?i)^ADR-[A-Z0-9-]*[A-Z0-9]$")) return "adr";
        if (id.matches("(?i)^SPEC-[A-Z0-9-]*[A-Z0-9]$")) return "spec";
        if (id.matches("(?i)^D-\\d{4}-[A-Z0-9-]*[A-Z0-9]$")) return "decision";
        if (id.matches("(?i)^SPRINT_[A-Z0-9_]+/[A-Z0-9-]+$")) return "task";
        return null;
    }

    /** Ссылки всех тел по порядку появления, без повторов (по типу+ID). */
    static List<Ref> parse(String... bodies) {
        Map<String, Ref> seen = new LinkedHashMap<>();
        if (bodies == null) return List.of();
        for (String body : bodies) {
            if (body == null || body.isEmpty()) continue;
            Matcher m = WIKI.matcher(stripCode(body));
            while (m.find()) {
                String inner = m.group(1).trim();
                if (inner.isEmpty()) continue;
                Matcher t = TYPED.matcher(inner);
                String type;
                String id;
                if (t.matches()) {
                    String word = t.group(1).toLowerCase(Locale.ROOT);
                    type = ALIASES.getOrDefault(word, word);
                    id = t.group(2).trim();
                } else {
                    id = inner;
                    type = typeByForm(id);
                }
                seen.putIfAbsent(type + "|" + id, new Ref(m.group(0), type, id));
            }
        }
        return new ArrayList<>(seen.values());
    }

    /** Вырезать код: огороженные блоки целиком, inline-код — заменой на пробелы. */
    static String stripCode(String md) {
        StringBuilder out = new StringBuilder(md.length());
        String fence = null;
        for (String line : md.split("\n", -1)) {
            if (fence != null) {
                String trimmed = line.strip();
                char fc = fence.charAt(0);
                if (trimmed.startsWith(fence) && trimmed.chars().allMatch(c -> c == fc)) fence = null;
                out.append('\n');
                continue;
            }
            Matcher f = FENCE_OPEN.matcher(line);
            if (f.find()) {
                fence = f.group(1);
                out.append('\n');
                continue;
            }
            out.append(line).append('\n');
        }
        return CODE_SPAN.matcher(out).replaceAll(" ");
    }

    /** Что делать с одним упоминанием в записи {@code fromType:fromId}. */
    static Decision decide(String fromType, String fromId, Ref ref) {
        if (ref.type() == null) return new Skip(ref, "unknown_form");
        if (LoreLinkTypes.entity(ref.type()) == null || LoreLinkTypes.entity(fromType) == null)
            return new Skip(ref, "unknown_type");
        if (ref.id() == null || !LoreResourceBase.SAFE_ID.matcher(ref.id()).matches())
            return new Skip(ref, "bad_id");
        if (fromType.equals(ref.type()) && ref.id().equals(fromId)) return new Skip(ref, "self");
        List<LoreLinkTypes.Option> typed = LoreLinkTypes.optionsFor(fromType, ref.type()).stream()
            .filter(o -> !o.fallback()).toList();
        if (typed.isEmpty()) return new Skip(ref, "references_only");
        if (typed.size() > 1) return new Skip(ref, "ambiguous_pair");
        LoreLinkTypes.Option o = typed.get(0);
        if (!LoreLinkTypes.isAuto(o.fromType(), o.edgeType(), o.toType())) return new Skip(ref, "not_auto_pair");
        return o.reversed()
            ? new Plan(ref, o, ref.id(), fromId)
            : new Plan(ref, o, fromId, ref.id());
    }

    /** Решения по всем упоминаниям тел записи — в порядке появления. */
    static List<Decision> plan(String fromType, String fromId, String... bodies) {
        List<Decision> out = new ArrayList<>();
        for (Ref r : parse(bodies)) out.add(decide(fromType, fromId, r));
        return out;
    }
}
