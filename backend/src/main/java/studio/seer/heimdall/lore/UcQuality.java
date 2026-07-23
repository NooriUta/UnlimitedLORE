package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Линтер качества UC по Коберну (ADR-LORE-027 §3-4, PL-12) — ЧИСТАЯ логика,
 * без БД и HTTP: одна и та же функция питает панель качества в форме (UI) и
 * MCP-инструмент uc_quality, поэтому оценки не могут разойтись по построению.
 *
 * Два веса (ADR-027-D1) задают РАЗНЫЙ знаменатель: обязательные проверки
 * casual — подмножество fully-dressed. Опциональные проверки возвращаются как
 * подсказки (required=false) и в счёт НЕ входят — advisory, сохранить можно
 * всегда (D14). Секции матчатся по заголовкам-конвенции (§1).
 */
final class UcQuality {

    private UcQuality() {}

    /** Одна находка линтера: прошла/не прошла, обязательна ли в выбранном весе. */
    record Finding(String code, boolean ok, boolean required, String message) {}

    /** Результат: score/max по ОБЯЗАТЕЛЬНЫМ выбранного веса + все находки. */
    record Result(String rigor, int score, int max, List<Finding> findings) {}

    /**
     * Строка-заполнитель шаблона: подсказка курсивом (`_Что запускает сценарий._`),
     * многоточие или голая пунктуация.
     *
     * <p>Понадобилось потому, что проверки были СТРУКТУРНЫМИ: наличие заголовка
     * засчитывалось как заполненная секция. Свежевставленный шаблон Кокберна —
     * одни заголовки и прочерки — набирал 7 из 10 и показывал «✓» напротив
     * секций, где не написано ни слова. Это хуже нулевой оценки: линтер
     * подтверждал качество текста, которого нет.
     */
    private static boolean isPlaceholder(String line) {
        String s = line.strip();
        if (s.isEmpty()) return true;
        if (s.matches("^[_*].*[_*]$")) return true;          // курсивная подсказка шаблона
        // Номер шага без содержания: «1. …», «2) ...»
        s = s.replaceFirst("^\\d+[.)]\\s*", "");
        return s.replaceAll("[…\\.\\-–—\\s]", "").isEmpty();
    }

    /** Есть ли в секции хоть одна СОДЕРЖАТЕЛЬНАЯ строка (не заполнитель). */
    private static boolean hasSection(String md, String name) {
        if (md == null) return false;
        if (!Pattern.compile("(?im)^\\s*#{2,3}\\s*" + Pattern.quote(name)).matcher(md).find()) return false;
        return sectionBody(md, name).lines().anyMatch(l -> !isPlaceholder(l));
    }

    private static String sectionBody(String md, String name) {
        if (md == null) return "";
        Matcher m = Pattern.compile("(?ims)^\\s*#{2,3}\\s*" + Pattern.quote(name) + "\\s*$(.*?)(?=^\\s*#{2,3}\\s|\\z)")
            .matcher(md);
        return m.find() ? m.group(1).trim() : "";
    }

    /** Номера шагов основного сценария: строки вида «1.», «2)». */
    static List<Integer> mainSteps(String scenarioMd) {
        List<Integer> steps = new ArrayList<>();
        // Считаем только шаги С СОДЕРЖАНИЕМ: «1. …» из шаблона — это разметка
        // места под шаг, а не шаг. Иначе пустой шаблон «сейчас 2 шага» проходил
        // проверку, для которой ничего не написано.
        Matcher m = Pattern.compile("(?m)^\\s*(\\d+)[.)]\\s+(\\S.*)$").matcher(sectionBody(scenarioMd, "Основной сценарий"));
        while (m.find()) {
            if (!isPlaceholder(m.group(2))) steps.add(Integer.parseInt(m.group(1)));
        }
        return steps;
    }

    /** Расширения «2a», «3b» → номер шага, на который ссылаются. */
    static List<Integer> extensionRefs(String scenarioMd) {
        List<Integer> refs = new ArrayList<>();
        Matcher m = Pattern.compile("(?m)^\\s*(\\d+)[a-z]\\b").matcher(sectionBody(scenarioMd, "Расширения"));
        while (m.find()) refs.add(Integer.parseInt(m.group(1)));
        return refs;
    }

    private static boolean hasNumberedList(String md) {
        return md != null && Pattern.compile("(?m)^\\s*\\d+[.)]\\s+\\S").matcher(md).find();
    }

    /**
     * Вход — уже собранные факты об UC (эндпоинт достаёт их из графа: primary-актор
     * и TRACED_TO — это рёбра, не текст). Линтер их только судит.
     */
    static Result evaluate(String rigor, String goalLevel, String scenarioMd, String acceptanceMd,
                           boolean hasPrimaryActor, boolean hasTracedTo) {
        boolean full = !"casual".equals(rigor); // дефолт и всё, кроме casual, — полный вес
        List<Finding> f = new ArrayList<>();

        // req = обязательна в ОБОИХ весах; opt = обязательна только в fully-dressed
        // (в casual становится подсказкой, required=false → вне счёта).
        req(f, "goal_level", goalLevel != null && !goalLevel.isBlank(), "Уровень цели задан");
        req(f, "trigger", hasSection(scenarioMd, "Триггер"), "Секция «Триггер»");
        opt(f, full, "preconditions", hasSection(scenarioMd, "Предусловия"), "Секция «Предусловия»");

        List<Integer> steps = mainSteps(scenarioMd);
        req(f, "main_scenario", steps.size() >= 2,
            "Основной сценарий: нумерованный список ≥2 шагов (сейчас " + steps.size() + ")");

        boolean hasExt = hasSection(scenarioMd, "Расширения");
        opt(f, full, "extensions_present", hasExt, "Секция «Расширения» (или явное «Расширений нет»)");
        // Ссылки на существующие шаги — проверяется, ТОЛЬКО если секция есть (обязательно всегда).
        if (hasExt) {
            List<Integer> refs = extensionRefs(scenarioMd);
            req(f, "extensions_ref_steps", !refs.isEmpty() && steps.containsAll(refs),
                "Расширения ссылаются на существующие шаги основного сценария");
        }

        req(f, "min_guarantees", hasSection(scenarioMd, "Минимальные гарантии"), "Секция «Минимальные гарантии»");
        opt(f, full, "success_guarantees", hasSection(scenarioMd, "Гарантии успеха"), "Секция «Гарантии успеха»");
        req(f, "primary_actor", hasPrimaryActor, "Primary-актор задан");

        // Приёмка (ADR-027-D2): проверяем СТРУКТУРУ, сам текст не трогаем.
        boolean acceptanceOk = full
            ? hasSection(acceptanceMd, "Проверки") && hasSection(acceptanceMd, "Покрытие расширений")
            : hasNumberedList(acceptanceMd);
        req(f, "acceptance", acceptanceOk,
            full ? "Приёмка: секции «Проверки» и «Покрытие расширений»"
                 : "Приёмка: непустой нумерованный список проверок");

        // TRACED_TO — подсказка в ОБОИХ весах (D9: опционален всегда), вне счёта.
        hint(f, "traced_to", hasTracedTo, "TRACED_TO задан (опционально, D9 — не штраф)");

        int max = 0, score = 0;
        for (Finding x : f) if (x.required()) { max++; if (x.ok()) score++; }
        return new Result(full ? "fully-dressed" : "casual", score, max, f);
    }

    private static void req(List<Finding> f, String code, boolean ok, String msg) {
        f.add(new Finding(code, ok, true, msg));
    }

    private static void opt(List<Finding> f, boolean requiredHere, String code, boolean ok, String msg) {
        f.add(new Finding(code, ok, requiredHere, msg));
    }

    private static void hint(List<Finding> f, String code, boolean ok, String msg) {
        f.add(new Finding(code, ok, false, msg));
    }
}
