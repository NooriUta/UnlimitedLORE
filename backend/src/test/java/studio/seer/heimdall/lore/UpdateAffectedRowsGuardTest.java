package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH Б11 · сторож «UPDATE без проверки числа задетых строк».
 *
 * <p>Пять лиц одного дефекта (Б6, Б11, A11–A13): запись, не нашедшая строку, отвечала {@code ok:true}.
 * PR #813 закрыл только {@code milestone_*}; правило общее: путь записи, UPDATE которого может
 * промахнуться, обязан проверить число задетых строк ({@link WriteCount}) и ответить 404/409 с причиной.
 *
 * <p>Сторож читает исходники пакета: каждый строковый литерал, начинающийся с {@code "UPDATE "}, —
 * путь записи. Он законен, если:
 * <ol>
 *   <li>это UPSERT (строка создаётся, промаха нет);</li>
 *   <li>условие WHERE ссылается на поле из SET — идемпотентный переход или дозаполнение
 *       («поставить closed, если ещё не closed», «заполнить, если пусто»): 0 строк = уже сделано;</li>
 *   <li>метод проверяет число строк — вызывает {@link WriteCount} (или прежний {@code affected(})).</li>
 * </ol>
 * Иначе путь обязан стоять в {@link #KNOWN_UNCHECKED} с пометкой TODO — список только сокращается:
 * новый путь без проверки валит сборку, а исправленный путь, оставшийся в списке, тоже (чтобы список
 * не врал).
 *
 * <p>Не сканируются: миграции схемы, инициализатор, сидер и пакетный ingest — там UPDATE массовые, и
 * «0 строк» значит «нечего править», а не промах.
 */
class UpdateAffectedRowsGuardTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");

    private static final Set<String> SKIP_FILES = Set.of(
        "LoreSchemaMigrationRunner.java", "LoreSchemaMigrations.java", "LoreSchemaInitializer.java",
        // доводка схемы кода (25.11.2026) — тот же слой миграций; её UPDATE — отметка номера схемы (одна запись)
        "LoreSchemaAdditive.java",
        "LoreComponentSeeder.java", "LoreIngestService.java");

    private static final String TODO = "TODO SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH Б11";

    /**
     * Пути без проверки, известные на 19.11.2026. Ключ — «Файл: начало литерала». Каждый — TODO задачи;
     * перечень не пополняется (новый путь пишется сразу с {@link WriteCount}).
     */
    static final Map<String, String> KNOWN_UNCHECKED = new TreeMap<>(Map.ofEntries(
        // переход статуса: строку только что открыли тем же скриптом (state_uid = nsid) — промах = сбой транзакции
        Map.entry("LoreStatusResource.java: UPDATE KnowSprintHist SET", TODO + ": перенос полей плана на новую версию спринта"),
        Map.entry("LoreStatusResource.java: UPDATE KnowSprintHist SET block_reason = :r WHERE state_uid", TODO + ": причина блокировки на новую версию"),
        Map.entry("LoreStatusResource.java: UPDATE KnowTaskHist SET", TODO + ": перенос полей задачи на новую версию"),
        Map.entry("StatusHistoryService.java: UPDATE", TODO + ": скрипт перехода SCD2 (close+insert), исход — Scd2Guard"),
        // best-effort отметки и зеркала (сбой — предупреждение в лог, не ответ)
        Map.entry("LoreResourceBase.java: UPDATE", TODO + ": touchUpdatedAt / закрытие ребра по @rid"),
        Map.entry("LoreResourceBase.java: UPDATE KnowSpec SET component_id=:cid WHERE spec_id=:sid", TODO + ": зеркало компонента спеки, best-effort"),
        Map.entry("LoreHashStamper.java: UPDATE", TODO + ": штамп content_hash по @rid, best-effort"),
        Map.entry("LoreCanvasResource.java: UPDATE KnowCanvas SET title = :t, template = :tpl, project =", TODO + ": правка холста"),
        Map.entry("LoreCanvasResource.java: UPDATE KnowCanvas SET updated_at = :now WHERE canvas_uid = :", TODO + ": отметка холста"),
        Map.entry("LoreComponentResource.java: UPDATE LoreComponent SET component_id=:cid", TODO + ": правка компонента"),
        Map.entry("LoreComponentResource.java: UPDATE LoreComponent SET parent_id=:pid, updated_at=:upd WHE", TODO + ": перенос компонента"),
        Map.entry("LoreMemoryResource.java: UPDATE KnowUserHabit SET hits = :h, label = :l, last_seen =", TODO + ": счётчик привычки"),
        Map.entry("LoreProductResource.java: UPDATE HAS_ACTOR SET role=:r", TODO + ": роль актора в проекте"),
        Map.entry("LoreProductResource.java: UPDATE KnowActor SET client_id=:c", TODO + ": client_id актора"),
        Map.entry("LoreQgResource.java: UPDATE QGRecommendation SET status='promoted' WHERE rec_id=:", TODO + ": продвижение рекомендации QG"),
        Map.entry("LoreReleaseCurrentReconciler.java: UPDATE KnowRelease SET is_current=true WHERE release_id = :r", TODO + ": текущий релиз"),
        Map.entry("LoreReleaseResource.java: UPDATE", TODO + ": проект PR по @rid"),
        Map.entry("LoreReleaseResource.java: UPDATE KnowPR SET", TODO + ": правка PR"),
        Map.entry("LoreReleaseResource.java: UPDATE KnowRelease SET", TODO + ": правка релиза (release_set)"),
        Map.entry("LoreReleaseResource.java: UPDATE KnowRelease SET git_project=:gp, release_uid=:ruid WH", TODO + ": перенос релиза"),
        Map.entry("LoreUserProfileResource.java: UPDATE KnowUser SET avatar_ref = :k WHERE kc_sub = :s", TODO + ": аватар"),
        Map.entry("LoreUserProfileResource.java: UPDATE KnowUser SET login = coalesce(login, display_name), d", TODO + ": имя пользователя"),
        Map.entry("LoreUserResource.java: UPDATE MACHINE_ACCESS SET projects =", TODO + ": доступ машины (исход перечитывается)"),
        Map.entry("LoreUserResource.java: UPDATE MACHINE_ACCESS SET role = :grole, granted_by = :gwho,", TODO + ": доступ машины (исход перечитывается)"),
        Map.entry("MachineActivity.java: UPDATE KnowActor SET", TODO + ": активность машины, best-effort"),
        Map.entry("QgSupervisorRoutine.java: UPDATE ClRoutineRun SET status = :st, finished_at = :fa, fla", TODO + ": итог прогона рутины"),
        Map.entry("TaskRoleService.java: UPDATE ROLE_HELD_BY SET verdict = :v, feedback_md = :f, revi", TODO + ": вердикт ревьюера"),
        Map.entry("UcReadinessCalculator.java: UPDATE KnowUseCase SET status = :s", TODO + ": производный статус сценария")
    ));

    record Hit(String file, String literal, String window, String method) {
        String key() {
            String head = literal.replaceAll("\\s+", " ").trim();
            return file + ": " + (head.length() > 60 ? head.substring(0, 60) : head).strip();
        }
    }

    private static final Pattern SET_FIELD = Pattern.compile("(?i)(?:\\bSET\\b|,)\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=");
    private static final Pattern SQL_HEAD = Pattern.compile("^UPDATE (?:[A-Za-z_][A-Za-z0-9_]*\\b|\\s*$)");
    private static final Pattern WHERE =Pattern.compile("(?i)\\bWHERE\\b(.*)", Pattern.DOTALL);

    static boolean isUpsert(Hit h) {
        if (h.window.contains("UPSERT")) return true;
        // UPDATE, собираемый по частям (StringBuilder): WHERE и UPSERT дописываются позже в том же методе
        return !h.window.contains("WHERE") && h.method.contains("UPSERT");
    }

    /** WHERE ссылается на поле из SET — переход/дозаполнение, промах = «уже сделано». */
    static boolean isConditional(Hit h) {
        String w = h.window;
        Matcher wm = WHERE.matcher(w);
        if (!wm.find()) return false;
        String where = wm.group(1);
        String set = w.substring(0, wm.start());
        Matcher f = SET_FIELD.matcher(set);
        while (f.find()) {
            String field = f.group(1);
            // состояние поля в условии: пусто/не пусто или сравнение с литералом (не с параметром-ключом)
            if (Pattern.compile("(?<![\\w.])" + Pattern.quote(field)
                    + "\\s*(?:IS\\b|(?:=|<>|!=)\\s*(?:'|true\\b|false\\b|null\\b|\\d))").matcher(where).find())
                return true;
        }
        return false;
    }

    static boolean isChecked(Hit h) {
        return h.method.contains("WriteCount.") || h.method.contains("affected(");
    }

    @Test
    void everyUpdateChecksAffectedRowsOrIsListed() throws IOException {
        List<Hit> hits = scan();
        assertTrue(hits.size() > 50, "положительный контроль: UPDATE в путях записи найдены (" + hits.size() + ")");
        Set<String> unchecked = new TreeSet<>();
        for (Hit h : hits) {
            if (isUpsert(h) || isConditional(h) || isChecked(h)) continue;
            unchecked.add(h.key());
        }
        List<String> fresh = unchecked.stream().filter(k -> !KNOWN_UNCHECKED.containsKey(k)).toList();
        List<String> fixed = KNOWN_UNCHECKED.keySet().stream().filter(k -> !unchecked.contains(k)).toList();
        assertEquals(List.of(), fresh, "UPDATE без проверки числа задетых строк (WriteCount): ответ ok:true при промахе");
        assertEquals(List.of(), fixed, "путь исправлен или переименован — убери его из KNOWN_UNCHECKED");
    }

    @Test
    void classifierSeesTheThreeLegalShapes() {
        Hit upsert = new Hit("X.java", "UPDATE KnowA SET a=:a", "\"UPDATE KnowA SET a=:a UPSERT WHERE id=:id\"", "");
        Hit cond = new Hit("X.java", "UPDATE KnowQuestion SET status='closed'",
            "\"UPDATE KnowQuestion SET status='closed', closed_date=:cd WHERE question_id=:q AND status <> 'closed'\"", "");
        Hit fill = new Hit("X.java", "UPDATE KnowDecision SET date_created=:d",
            "\"UPDATE KnowDecision SET date_created=:d WHERE decision_id=:did AND date_created IS NULL\"", "");
        Hit plain = new Hit("X.java", "UPDATE KnowADR SET adr_id=:nid", "\"UPDATE KnowADR SET adr_id=:nid WHERE adr_id=:oid\"", "");
        assertTrue(isUpsert(upsert));
        assertTrue(isConditional(cond));
        assertTrue(isConditional(fill));
        assertTrue(!isUpsert(plain) && !isConditional(plain) && !isChecked(plain), "переименование по ключу — промах возможен");
        assertTrue(isChecked(new Hit("X.java", "", "", "WriteCount.require(r, \"adr\", id)")));
    }

    // ── разбор исходников ────────────────────────────────────────────────────

    static List<Hit> scan() throws IOException {
        List<Hit> out = new ArrayList<>();
        try (Stream<Path> files = Files.list(SRC)) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).sorted().toList()) {
                String name = p.getFileName().toString();
                if (SKIP_FILES.contains(name)) continue;
                out.addAll(scanFile(name, Files.readString(p, StandardCharsets.UTF_8)));
            }
        }
        return out;
    }

    static List<Hit> scanFile(String name, String src) {
        List<Hit> out = new ArrayList<>();
        int n = src.length();
        int[] depth = new int[n + 1];
        boolean[] code = new boolean[n];
        Set<Integer> literalStarts = new java.util.HashSet<>();
        // глубина скобок {} и признак «код, а не строка/комментарий»
        int d = 0;
        for (int i = 0; i < n; i++) {
            char c = src.charAt(i);
            if (c == '/' && i + 1 < n && src.charAt(i + 1) == '/') {
                int e = src.indexOf('\n', i); e = e < 0 ? n : e;
                for (int k = i; k < e; k++) depth[k] = d;
                i = e - 1; continue;
            }
            if (c == '/' && i + 1 < n && src.charAt(i + 1) == '*') {
                int e = src.indexOf("*/", i + 2); e = e < 0 ? n : e + 2;
                for (int k = i; k < e; k++) depth[k] = d;
                i = e - 1; continue;
            }
            if (c == '"' || c == '\'') {
                if (c == '"') literalStarts.add(i);
                int e = endOfLiteral(src, i);
                for (int k = i; k < e; k++) depth[k] = d;
                i = e - 1; continue;
            }
            code[i] = true;
            if (c == '{') d++;
            depth[i] = d;
            if (c == '}') d--;
        }
        Matcher m = Pattern.compile("\"UPDATE ").matcher(src);
        while (m.find()) {
            int at = m.start();
            if (!literalStarts.contains(at)) continue;
            int litEnd = endOfLiteral(src, at);
            String literal = src.substring(at + 1, Math.max(at + 1, litEnd - 1));
            // SQL, а не текст сообщения («UPDATE выполнен, но …»): за UPDATE — имя типа или склейка
            if (!SQL_HEAD.matcher(literal).find()) continue;
            int stmtEnd = at;
            while (stmtEnd < n && !(code[stmtEnd] && src.charAt(stmtEnd) == ';')) stmtEnd++;
            String window = src.substring(at, stmtEnd);
            String method = enclosingBlock(src, code, at);
            // UPDATE собирает метод-построитель (taskVertexUpdate), а исполняет и проверяет вызывающий:
            // к телу добавляются тела методов, которые его вызывают
            String mname = methodName(src, code, at);
            if (mname != null) {
                Matcher call = Pattern.compile("(?<![\\w.])" + Pattern.quote(mname) + "\\s*\\(").matcher(src);
                StringBuilder callers = new StringBuilder(method);
                while (call.find()) {
                    if (!code[call.start()]) continue;
                    String caller = enclosingBlock(src, code, call.start());
                    if (!caller.equals(method)) callers.append('\n').append(caller);
                }
                method = callers.toString();
            }
            out.add(new Hit(name, literal, window, method));
        }
        return out;
    }

    /** Имя метода, в теле которого стоит позиция: идентификатор перед «(» в заголовке блока глубины 2. */
    private static String methodName(String src, boolean[] code, int at) {
        int d = 0, start = -1;
        for (int i = 0; i < at; i++) {
            if (!code[i]) continue;
            char c = src.charAt(i);
            if (c == '{') { d++; if (d == 2) start = i; }
            else if (c == '}') d--;
        }
        if (start < 0 || d < 2) return null;
        int h = start - 1;
        while (h >= 0 && !(code[h] && (src.charAt(h) == ';' || src.charAt(h) == '}' || src.charAt(h) == '{'))) h--;
        // только код заголовка: javadoc и строки аннотаций — пробелами
        StringBuilder header = new StringBuilder();
        for (int k = h + 1; k < start; k++) header.append(code[k] ? src.charAt(k) : ' ');
        // первое имя с «(», не аннотация (@Path("…") стоит раньше имени метода)
        Matcher m = Pattern.compile("(?<!@)\\b([A-Za-z_][A-Za-z0-9_]*)\\s*\\(").matcher(header);
        return m.find() ? m.group(1) : null;
    }

    private static int endOfLiteral(String src, int i) {
        char q = src.charAt(i);
        if (q == '"' && src.startsWith("\"\"\"", i)) {
            int e = src.indexOf("\"\"\"", i + 3);
            return e < 0 ? src.length() : e + 3;
        }
        int k = i + 1;
        while (k < src.length()) {
            char c = src.charAt(k);
            if (c == '\\') { k += 2; continue; }
            if (c == q || c == '\n') return k + 1;
            k++;
        }
        return src.length();
    }

    /** Тело метода (блок глубины 2: класс → метод), в котором стоит позиция. */
    private static String enclosingBlock(String src, boolean[] code, int at) {
        int d = 0, start = -1;
        int[] stack = new int[256];
        for (int i = 0; i < at; i++) {
            if (!code[i]) continue;
            char c = src.charAt(i);
            if (c == '{') { if (d < stack.length) stack[d] = i; d++; }
            else if (c == '}') d--;
        }
        if (d >= 2) start = stack[1];
        if (start < 0) return "";
        int dd = 0;
        for (int i = start; i < src.length(); i++) {
            if (!code[i]) continue;
            char c = src.charAt(i);
            if (c == '{') dd++;
            else if (c == '}' && --dd == 0) return src.substring(start, i + 1);
        }
        return src.substring(start);
    }
}
