package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * Линтер полноты спринта и задачи — ЧИСТАЯ логика, без БД и HTTP, по образцу
 * {@link UcQuality}. Одна и та же функция питает ответ write-пути и (в
 * перспективе) панель в UI, поэтому оценки не могут разойтись по построению.
 *
 * <p><b>Зачем.</b> Четыре поля забываются раз за разом — статус, компонент,
 * оценка по времени, проект, — и до сих пор о них НАПОМИНАЛ ЧЕЛОВЕК. Слайсы
 * {@code product_hygiene} и {@code unlinked_*} ловят часть этого, но постфактум
 * и только если кто-то откроет срез; к тому моменту контекст записи утерян.
 * Здесь вердикт возвращается В ОТВЕТЕ НА ЗАПИСЬ — в момент, когда автор ещё
 * держит задачу в голове и может дописать одним вызовом.
 *
 * <p><b>Advisory, никогда не блокирует.</b> Тот же принцип, что у UC-линтера
 * (ADR-LORE-027-D14): сохранить можно всегда. Отказ в записи из-за
 * незаполненной оценки превратил бы вспомогательную дисциплину в препятствие и
 * заставил бы обходить её мусорными значениями — а мусорное «0.1 дня» хуже
 * честного пропуска, потому что неотличимо от настоящей оценки.
 *
 * <p><b>Почему часть проверок условные.</b> {@code work_class} по ADR-LORE-022
 * (D3) законно бывает пустым, поэтому сам по себе он подсказка. Но ЕСЛИ класс
 * задан, дисциплина связей обязательна: {@code uc} без REALIZES и {@code enb}
 * без JUSTIFIED_BY — ровно те две находки, которые сегодня копятся в
 * {@code product_hygiene} сотнями.
 */
final class WorkQuality {

    private WorkQuality() {}

    /** Одна находка: прошла/не прошла, обязательна ли (обязательные идут в счёт). */
    record Finding(String code, boolean ok, boolean required, String message) {}

    /** Результат: score/max по обязательным + все находки, включая подсказки. */
    record Result(String kind, int score, int max, List<Finding> findings) {}

    private static boolean filled(String s) {
        return s != null && !s.isBlank();
    }

    /** Траверс графа отдаёт скаляр либо список — пусто значит «ребра нет». */
    private static boolean any(Object raw) {
        if (raw == null) return false;
        if (raw instanceof Collection<?> c) {
            return c.stream().anyMatch(o -> o != null && !String.valueOf(o).isBlank());
        }
        return !String.valueOf(raw).isBlank();
    }

    /**
     * Задача. Факты собирает вызывающий из графа — линтер их только судит.
     *
     * @param statusRaw  текущий статус из открытой HAS_STATE
     * @param effortDays оценка с той же строки; {@code null} = не задана
     * @param workClass  uc | jtd | enb | null (null легален, D3)
     * @param components TAGGED_WITH задачи ИЛИ унаследованные от спринта
     * @param projects   BELONGS_TO_PROJECT спринта — у задачи своего ребра нет
     * @param realizesUc REALIZES → KnowUseCase
     * @param justifiedBy JUSTIFIED_BY → KnowADR
     */
    static Result evaluateTask(String statusRaw, Double effortDays, String workClass,
                               Object components, Object projects,
                               Object realizesUc, Object justifiedBy) {
        List<Finding> f = new ArrayList<>();

        req(f, "status", filled(statusRaw), "Статус задан");
        // Оценка: ноль и отрицательное — не оценка. 0 не отличить от «забыл
        // поставить», а именно это забывание проверка и ловит.
        req(f, "effort_days", effortDays != null && effortDays > 0,
            "Оценка по времени задана (effort_days > 0)");
        req(f, "component", any(components), "Компонент привязан (свой или от спринта)");
        req(f, "project", any(projects), "Проект известен (через спринт)");

        // Класс работы: сам по себе подсказка (D3), но задаёт обязательные связи.
        hint(f, "work_class", filled(workClass), "Класс работы задан (uc | jtd | enb) — опционально");
        if ("uc".equals(workClass)) {
            req(f, "realizes_uc", any(realizesUc),
                "work_class=uc обязан нести REALIZES на сценарий");
        }
        if ("enb".equals(workClass)) {
            req(f, "justified_by", any(justifiedBy),
                "work_class=enb обязан нести JUSTIFIED_BY на ADR");
        }

        return score("task", f);
    }

    /**
     * Спринт.
     *
     * @param plannedStart планируемое начало; вместе с концом это «оценка по времени» спринта
     * @param milestones   TARGETS_MILESTONE — подсказка, не штраф (ловит strategic_coverage)
     */
    static Result evaluateSprint(String statusRaw, Object projects, Object components,
                                 String plannedStart, String plannedEnd, Object milestones) {
        List<Finding> f = new ArrayList<>();

        req(f, "status", filled(statusRaw), "Статус задан");
        req(f, "project", any(projects), "Проект привязан (BELONGS_TO_PROJECT)");
        req(f, "component", any(components), "Компонент привязан (BELONGS_TO)");
        // Обе даты вместе: одна без другой не даёт ни длительности, ни места на
        // доске плана — а именно ради доски они и заполняются.
        req(f, "planned_dates", filled(plannedStart) && filled(plannedEnd),
            "Плановые даты заданы (начало и конец)");

        hint(f, "milestone", any(milestones), "Веха привязана — опционально");

        return score("sprint", f);
    }

    /**
     * Релиз. Самая дорогая из проверок этого набора: пустые связи релиза —
     * записанная боль [[PAIN-LORE-BROKEN-LINKS]], а не гипотеза. Релиз уезжает,
     * выглядит опубликованным, и только потом выясняется, что по нему нельзя
     * ответить, что в него вошло — когда контекст уже утерян.
     *
     * <p>Спринты и PR проверяются РАЗДЕЛЬНО намеренно: это два разных вызова
     * {@code release_link}, и забывается обычно первый. «Связи есть» без
     * разделения показывало бы зелёное при половине работы.
     */
    static Result evaluateRelease(String gitTag, String descriptionMd,
                                  Object sprints, Object prs, Object projects) {
        List<Finding> f = new ArrayList<>();

        req(f, "git_tag", filled(gitTag), "Тег задан");
        req(f, "description", filled(descriptionMd),
            "Описание непусто — пустой релиз выглядит опубликованным и прячет пропажу описания");
        req(f, "sprints_linked", any(sprints), "Привязан хотя бы один спринт");
        req(f, "prs_linked", any(prs), "Привязан хотя бы один PR");
        req(f, "project", any(projects), "Проект привязан");

        return score("release", f);
    }

    /**
     * ADR. Тела проверяются на НЕПУСТОТУ, а не на содержание: судить текст
     * линтер не может и не должен. Но ADR без раздела «решение» — это не
     * решение, а заметка, и отличить одно от другого структурно можно.
     *
     * @param hasDecisions есть ли дочерние KnowDecision (DECIDED_IN)
     */
    static Result evaluateAdr(String status, Object components, Object projects,
                              boolean hasDecisions,
                              String contextMd, String decisionMd, String consequencesMd) {
        List<Finding> f = new ArrayList<>();

        req(f, "status", filled(status), "Статус задан");
        req(f, "component", any(components), "Компонент привязан");
        req(f, "project", any(projects), "Проект привязан");
        req(f, "context", filled(contextMd), "Контекст заполнен");
        req(f, "decision", filled(decisionMd), "Решение заполнено");
        // Последствия — подсказка: бывают ADR, у которых их честно нет, и
        // требовать текст ради текста значит поощрять воду.
        hint(f, "consequences", filled(consequencesMd), "Последствия заполнены — желательно");
        // Атомарные решения: ADR без них не разложен на проверяемые правила
        // (ADR-LORE-014 §4). Подсказка, а не штраф: разложение — отдельный шаг,
        // и требовать его в момент заведения ADR значит блокировать черновик.
        hint(f, "decisions", hasDecisions, "Разложен на атомарные решения — желательно");

        return score("adr", f);
    }

    private static Result score(String kind, List<Finding> f) {
        int max = 0, score = 0;
        for (Finding x : f) if (x.required()) { max++; if (x.ok()) score++; }
        return new Result(kind, score, max, f);
    }

    private static void req(List<Finding> f, String code, boolean ok, String msg) {
        f.add(new Finding(code, ok, true, msg));
    }

    private static void hint(List<Finding> f, String code, boolean ok, String msg) {
        f.add(new Finding(code, ok, false, msg));
    }
}
