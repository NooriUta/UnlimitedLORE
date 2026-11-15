package studio.seer.heimdall.lore;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * SPRINT_LORE_MD_ARCHIVE/MDA-02 — сборщик выгрузки проекта в папку .md под Obsidian.
 *
 * <p>Чистая функция: записи проекта (уже прочитанные срезами под правами вызывающего) на
 * входе, карта «путь → текст» на выходе. Без БД и без времени — две выгрузки одного
 * состояния дают одни и те же байты (критерий спринта).
 *
 * <p>Раскладка согласована владелицей 14.11.2026 (MDA-01) и проверена на образце
 * docs/prototypes/mda-01-vault настоящим резолвером Obsidian:
 * <ul>
 *   <li>всё лежит в {@code LORE/<owner>__<repo>/} — граница владения, LORE перезаписывает папку целиком;</li>
 *   <li>одна запись — один файл {@code <ID>.md} в папке своего типа; задача — в папке спринта
 *       ({@code tasks/<SPRINT_ID>/<CODE>.md}), Obsidian резолвит {@code [[SPRINT_X/CODE]]} по концу пути;</li>
 *   <li>ссылка LORE {@code [[тип:ID]]} на запись архива → {@code [[ID|тип:ID]]}; на запись вне
 *       архива → инлайн-код (не битая ссылка в графе);</li>
 *   <li>буквальный {@code [[…]]}, который не ведёт на запись архива, → инлайн-код;</li>
 *   <li>в строках таблиц {@code |} алиаса экранируется — иначе режет ячейку;</li>
 *   <li>только текущее состояние, без истории SCD2.</li>
 * </ul>
 */
final class LoreVaultExport {

    private LoreVaultExport() {}

    /** Запись проекта. {@code fields} — дополнительные поля frontmatter (числа, строки, списки строк). */
    record Rec(String type, String id, String title, String status, String body, Map<String, Object> fields) {}

    /**
     * Вход сборщика. {@code unreadable}: тип → причина, по которой его не смогли прочитать
     * (это не «пусто»); {@code hiddenByRights}: сколько записей срезано правами вызывающего.
     */
    record Input(String projectSlug, String projectName, List<Rec> records,
                 Map<String, String> unreadable, int hiddenByRights) {}

    /** Тип → папка и подпись в index.md. Порядок — порядок строк таблицы состава. */
    static final Map<String, String[]> TYPES = types();

    private static Map<String, String[]> types() {
        Map<String, String[]> m = new LinkedHashMap<>();
        m.put("sprint", new String[]{"sprints", "спринт"});
        m.put("task", new String[]{"tasks", "задача"});
        m.put("adr", new String[]{"adr", "ADR"});
        m.put("decision", new String[]{"decisions", "решение"});
        m.put("spec", new String[]{"specs", "спека"});
        m.put("doc", new String[]{"docs", "док"});
        m.put("runbook", new String[]{"runbooks", "ранбук"});
        m.put("release", new String[]{"releases", "релиз"});
        m.put("question", new String[]{"questions", "вопрос"});
        m.put("component", new String[]{"components", "компонент"});
        return Collections.unmodifiableMap(m);
    }

    private static final Pattern ILLEGAL = Pattern.compile("[:*?\"<>|\\\\]");
    private static final Pattern WIKI = Pattern.compile("\\[\\[([^\\[\\]\\n]{1,200})\\]\\]");
    private static final Pattern FENCE = Pattern.compile("^ {0,3}(`{3,}|~{3,})");
    private static final Pattern INLINE = Pattern.compile("(`+)[\\s\\S]*?[^`]\\1(?!`)|(`+)\\2(?!`)");

    static String root(String slug) {
        return "LORE/" + slug.replace("/", "__") + "/";
    }

    /** Файл записи относительно корня. ID задачи «SPRINT/CODE» — путь; прочие «/» и запрещённые символы → «_». */
    static String path(Rec r) {
        String[] t = TYPES.get(r.type());
        String folder = t == null ? "other/" + safe(r.type()) : t[0];
        if ("task".equals(r.type()) && r.id().contains("/")) {
            int i = r.id().indexOf('/');
            return folder + "/" + safe(r.id().substring(0, i)) + "/" + safe(r.id().substring(i + 1)) + ".md";
        }
        return folder + "/" + safe(r.id()) + ".md";
    }

    private static String safe(String s) {
        return ILLEGAL.matcher(s.replace('/', '_')).replaceAll("_");
    }

    static Map<String, String> build(Input in) {
        String root = root(in.projectSlug());
        List<Rec> recs = new ArrayList<>(in.records());
        recs.sort((a, b) -> {
            int c = a.type().compareTo(b.type());
            return c != 0 ? c : a.id().compareTo(b.id());
        });
        Set<String> ids = new TreeSet<>();
        for (Rec r : recs) ids.add(r.id());
        String projectLink = "[[" + in.projectSlug().replace("/", "__") + "/index|" + in.projectSlug() + "]]";

        Map<String, String> out = new TreeMap<>();
        for (Rec r : recs) out.put(root + path(r), file(r, ids, projectLink));
        out.put(root + "index.md", index(in, recs, ids));
        return out;
    }

    private static String file(Rec r, Set<String> ids, String projectLink) {
        StringBuilder sb = new StringBuilder("---\n");
        sb.append("id: ").append(q(r.id())).append('\n');
        sb.append("type: ").append(r.type()).append('\n');
        sb.append("title: ").append(q(nz(r.title()))).append('\n');
        if (r.status() != null && !r.status().isBlank()) sb.append("status: ").append(scalar(r.status())).append('\n');
        sb.append("project: ").append(q(projectLink)).append('\n');
        if ("task".equals(r.type()) && r.id().contains("/"))
            sb.append("sprint: ").append(q("[[" + r.id().substring(0, r.id().indexOf('/')) + "]]")).append('\n');
        for (Map.Entry<String, Object> f : new TreeMap<>(r.fields()).entrySet()) {
            Object v = f.getValue();
            if (v == null) continue;
            if (v instanceof List<?> list) {
                if (list.isEmpty()) continue;
                sb.append(f.getKey()).append(":\n");
                for (Object o : list) sb.append("  - ").append(q(String.valueOf(o))).append('\n');
            } else if (v instanceof Number || v instanceof Boolean) {
                sb.append(f.getKey()).append(": ").append(v).append('\n');
            } else {
                sb.append(f.getKey()).append(": ").append(q(String.valueOf(v))).append('\n');
            }
        }
        sb.append("---\n\n");
        String body = rewrite(nz(r.body()), ids);
        sb.append(body);
        if (!body.isEmpty() && !body.endsWith("\n")) sb.append('\n');
        return sb.toString();
    }

    /** Ссылки тела: вне блоков и строк кода; в строках таблиц `|` алиаса экранируется. */
    static String rewrite(String md, Set<String> ids) {
        StringBuilder out = new StringBuilder();
        String fence = null;
        String[] lines = md.split("\n", -1);
        for (int li = 0; li < lines.length; li++) {
            String line = lines[li];
            Matcher fm = FENCE.matcher(line);
            if (fence == null && fm.find()) fence = fm.group(1).substring(0, 3);
            else if (fence != null && line.trim().startsWith(fence)) { out.append(line); fence = null; if (li < lines.length - 1) out.append('\n'); continue; }
            if (fence != null) { out.append(line); if (li < lines.length - 1) out.append('\n'); continue; }
            boolean table = line.trim().startsWith("|");
            out.append(rewriteLine(line, ids, table));
            if (li < lines.length - 1) out.append('\n');
        }
        return out.toString();
    }

    private static String rewriteLine(String line, Set<String> ids, boolean table) {
        StringBuilder sb = new StringBuilder();
        Matcher code = INLINE.matcher(line);
        int pos = 0;
        while (code.find()) {
            sb.append(rewriteText(line.substring(pos, code.start()), ids, table));
            sb.append(code.group());
            pos = code.end();
        }
        sb.append(rewriteText(line.substring(pos), ids, table));
        return sb.toString();
    }

    private static String rewriteText(String s, Set<String> ids, boolean table) {
        Matcher m = WIKI.matcher(s);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String inner = m.group(1);
            String target = inner, label = null;
            int bar = inner.indexOf('|');
            if (bar >= 0) { target = inner.substring(0, bar).replace("\\", ""); label = inner.substring(bar + 1); }
            String typed = null, id = target.trim();
            int colon = id.indexOf(':');
            if (colon > 0 && id.substring(0, colon).matches("[A-Za-z_]+")) {
                typed = id.substring(0, colon).toLowerCase(Locale.ROOT);
                id = id.substring(colon + 1);
            }
            String rep;
            if (ids.contains(id)) {
                String alias = label != null ? label : (typed != null ? typed + ":" + id : null);
                rep = alias == null ? "[[" + id + "]]" : "[[" + id + (table ? "\\|" : "|") + alias + "]]";
            } else if (typed != null) {
                rep = "`" + typed + ":" + id + "`";
            } else {
                rep = "`" + m.group() + "`";
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(rep));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String index(Input in, List<Rec> recs, Set<String> ids) {
        Map<String, Integer> count = new LinkedHashMap<>();
        for (Rec r : recs) count.merge(r.type(), 1, Integer::sum);
        StringBuilder sb = new StringBuilder("---\n");
        sb.append("id: ").append(q(in.projectSlug())).append('\n');
        sb.append("type: project\n");
        sb.append("title: ").append(q(nz(in.projectName()))).append('\n');
        sb.append("---\n\n");
        sb.append("# ").append(nz(in.projectName())).append(" — выгрузка LORE\n\n");
        sb.append("> Эту папку целиком пишет LORE и при следующей выгрузке перезапишет её полностью. ")
          .append("Свои заметки держите рядом, вне `LORE/` — их LORE не трогает.\n\n");
        sb.append("## Состав\n\n| тип | папка | записей |\n|---|---|---|\n");
        for (Map.Entry<String, String[]> t : TYPES.entrySet()) {
            String n = in.unreadable().containsKey(t.getKey()) ? "не прочитано"
                : String.valueOf(count.getOrDefault(t.getKey(), 0));
            sb.append("| ").append(t.getValue()[1]).append(" | `").append(t.getValue()[0]).append("/` | ")
              .append(n).append(" |\n");
        }
        sb.append("\n## Честность выгрузки\n\n");
        sb.append("- записей: ").append(recs.size()).append('\n');
        sb.append("- скрыто правами: ").append(in.hiddenByRights())
          .append(" — «скрыто» и «пусто» пишутся раздельно\n");
        if (in.unreadable().isEmpty()) {
            sb.append("- не смогли прочитать: 0\n");
        } else {
            sb.append("- не смогли прочитать (это не «пусто»):\n");
            for (Map.Entry<String, String> u : new TreeMap<>(in.unreadable()).entrySet())
                sb.append("  - ").append(u.getKey()).append(": ").append(u.getValue()).append('\n');
        }
        return sb.toString();
    }

    /** Детерминированный zip: порядок записей — по пути, время записей фиксировано. */
    static byte[] zip(Map<String, String> files) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(bos, StandardCharsets.UTF_8)) {
            for (Map.Entry<String, String> f : new TreeMap<>(files).entrySet()) {
                ZipEntry e = new ZipEntry(f.getKey());
                e.setTime(FIXED_TIME);
                z.putNextEntry(e);
                z.write(f.getValue().getBytes(StandardCharsets.UTF_8));
                z.closeEntry();
            }
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
        return bos.toByteArray();
    }

    /** 2026-01-01T00:00:00Z — время в архиве не должно зависеть от момента выгрузки. */
    private static final long FIXED_TIME = 1767225600000L;

    private static String nz(String s) { return s == null ? "" : s; }

    /** YAML-строка в двойных кавычках. */
    private static String q(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }

    /** Простое значение без кавычек, если безопасно; иначе — в кавычках. */
    private static String scalar(String s) {
        return s.matches("[A-Za-z0-9_.\\-]+") ? s : q(s);
    }
}
