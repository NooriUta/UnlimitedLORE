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
 * <p><b>Почему часть проверок условные.</b> {@code work_class} ADR-LORE-022 (D3)
 * объявлял законно пустым, но решением владельца (2026-08-03) он ОБЯЗАТЕЛЕН —
 * см. развёрнутое обоснование у самой проверки. Условны проверки связей: ЕСЛИ
 * класс задан, дисциплина обязательна — {@code uc} без REALIZES и {@code enb}
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

        // Класс работы — ОБЯЗАТЕЛЕН (решение владельца 2026-08-03).
        //
        // ADR-LORE-022 D3 объявлял пустой work_class легальным, и до сих пор он
        // был подсказкой. Практика показала цену: класс задан у 256 задач из
        // 3267, и «зачем-ось» INVEST-профиля считается на 2.3% трудоёмкости.
        // Показатель, посчитанный на такой доле, не отвечает на вопрос, ради
        // которого заведён, а выглядит рабочим.
        //
        // Проверка остаётся advisory — она не блокирует запись, а понижает счёт
        // и называет пропуск. Это нажим, а не запрет: превратить в запрет
        // значило бы поощрять простановку класса наугад, а неверный класс хуже
        // пустого, потому что неотличим от осознанного.
        req(f, "work_class", filled(workClass), "Класс работы задан (uc | jtd | enb)");
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
        return evaluateAdr(status, components, projects, hasDecisions,
            contextMd, decisionMd, consequencesMd, false);
    }

    /**
     * ADR с механическими проверками структуры (ADR-LORE-039 §5).
     *
     * @param hasSupersedesEdge есть ли ребро SUPERSEDES — нужно для проверки
     *                          когерентности статуса SUPERSEDED
     */
    static Result evaluateAdr(String status, Object components, Object projects,
                              boolean hasDecisions,
                              String contextMd, String decisionMd, String consequencesMd,
                              boolean hasSupersedesEdge) {
        // ВЕС ПО СТАТУСУ, как casual/fully-dressed у UC (ADR-LORE-027). PROPOSED —
        // черновик: разложение, последствия и альтернативы там законно
        // отсутствуют, и штрафовать за это значит давить на самом хрупком этапе.
        // ACCEPTED — принятое правило: оно обязано быть разложено и иметь
        // последствия, иначе «принято» сказано о заметке. Один и тот же список
        // проверок даёт разный ЗНАМЕНАТЕЛЬ, а не разный набор.
        boolean accepted = "ACCEPTED".equalsIgnoreCase(status);
        List<Finding> f = new ArrayList<>();

        req(f, "status", filled(status), "Статус задан");
        req(f, "component", any(components), "Компонент привязан");
        req(f, "project", any(projects), "Проект привязан");
        req(f, "context", filled(contextMd), "Контекст заполнен");
        req(f, "decision", filled(decisionMd), "Решение заполнено");

        // Порог содержательности. Судится ОБЪЁМ, не смысл: раздел из полутора
        // строк — это отписка, и отличить её от разбора структурно можно, а
        // судить формулировки линтер не может и не должен.
        opt(f, accepted, "context_substantive", len(contextMd) >= MIN_BODY,
            "Контекст содержателен (≥ " + MIN_BODY + " симв.)");
        opt(f, accepted, "decision_substantive", len(decisionMd) >= MIN_BODY,
            "Решение содержательно (≥ " + MIN_BODY + " симв.)");

        // Разделы по конвенции заголовков. «Альтернативы» — подсказка даже у
        // ACCEPTED: бывают решения без развилки, и требовать вымышленный второй
        // вариант значит поощрять выдумку.
        hint(f, "alternatives", hasHeading(decisionMd, "льтернатив"),
            "Раздел «Рассмотренные альтернативы» — желательно");

        // Трассируемость: решение, не ссылающееся ни на один ADR/решение, стоит
        // особняком от корпуса. Подсказка у черновика, требование у принятого.
        opt(f, accepted, "traceability", refsEntity(decisionMd),
            "Решение ссылается хотя бы на один ADR-*/D-* — трассируемость");

        // Последствия и разложение: у черновика — подсказки (разложение отдельный
        // шаг, и требовать его при заведении значит блокировать черновик), у
        // принятого — обязательны (ADR-LORE-014 §4).
        opt(f, accepted, "consequences", filled(consequencesMd),
            accepted ? "Последствия заполнены" : "Последствия заполнены — желательно");
        opt(f, accepted, "decisions", hasDecisions,
            accepted ? "Разложен на атомарные решения" : "Разложен на атомарные решения — желательно");

        // Когерентность статуса: SUPERSEDED без ребра SUPERSEDES — утверждение о
        // замене, которое нечем проверить, и цепочка решений обрывается.
        if ("SUPERSEDED".equalsIgnoreCase(status)) {
            req(f, "supersedes_edge", hasSupersedesEdge,
                "Статус SUPERSEDED требует ребра SUPERSEDES на заменяющий ADR");
        }

        return score("adr", f);
    }

    /** Порог «раздел заполнен, а не отписан». Символы, не слова: слова считать дороже, а разницы нет. */
    private static final int MIN_BODY = 120;

    private static int len(String s) {
        return s == null ? 0 : s.trim().length();
    }

    /** Заголовок markdown, содержащий фрагмент (без учёта регистра и окончания). */
    private static boolean hasHeading(String md, String fragment) {
        if (md == null) return false;
        return java.util.regex.Pattern
            .compile("(?mi)^#{1,6}\\s*.*" + java.util.regex.Pattern.quote(fragment))
            .matcher(md).find();
    }

    /** Ссылка на сущность корпуса: ADR-… или D-… . */
    private static boolean refsEntity(String md) {
        return md != null && java.util.regex.Pattern.compile("\\b(ADR-[A-Z0-9-]+|D-[A-Z0-9-]{4,})")
            .matcher(md).find();
    }

    private static void opt(List<Finding> f, boolean requiredHere, String code, boolean ok, String msg) {
        f.add(new Finding(code, ok, requiredHere, msg));
    }

    /**
     * Фаза спринта.
     *
     * <p><b>Про «типизацию фаз».</b> Поля типа у {@code KnowPhase} в схеме НЕТ:
     * фаза несёт {@code phase_id}, {@code order_index}, заголовок и
     * {@code summary_md}. Завести тип фазы — это миграция схемы плюс канон-словарь,
     * то есть решение о модели, а не правка линтера. Пока проверяется полнота
     * тем, что есть: у фазы должно быть чем отличаться от соседней.
     *
     * <p>Безымянная фаза с пустым описанием — это разделитель, а не этап: она
     * ничего не говорит ни о содержании, ни о готовности, и в отчётах даёт
     * строку, по которой нельзя принять решение.
     */
    static Result evaluatePhase(String title, String summaryMd, Integer orderIndex) {
        List<Finding> f = new ArrayList<>();

        req(f, "title", filled(title), "Название задано");
        req(f, "order_index", orderIndex != null, "Порядковый номер задан");
        // Описание — подсказка: короткая фаза с говорящим названием может
        // обойтись без него, и требовать текст ради текста значит поощрять воду.
        hint(f, "summary", filled(summaryMd), "Описание заполнено — желательно");

        return score("phase", f);
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
