package studio.seer.heimdall.lore.news;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-09: модель входа единого сервиса новостей v2.
 *
 * <p>Главное правило (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0): всё считается ОДИН
 * раз на сервере, веб v1, веб v2 и miniLORE только рисуют. Здесь — только
 * нормализованные данные из SCD2; ни одной метрики. Метрики считает
 * {@link NewsV2Engine}, чистая функция от {@link Input}: без БД, без Quarkus,
 * поэтому её проверяет обычный юнит-тест на фикстуре §10.4.
 */
public final class NewsV2 {

    private NewsV2() {}

    /** Категория статуса задачи (D-2026-UXR-STATUS-AXIS): открыта / готова к выкатке / закрыта. */
    public enum Cat { OPEN, READY, CLOSED }

    /** Версия SCD2-истории задачи: момент открытия строки и её status_raw. */
    public record Version(Instant at, String status) {}

    /**
     * Задача спринта. {@code versions} — ВСЕ датированные версии (в том числе
     * после t1: они нужны только сверке со снимком §10.2, в расчёт не входят).
     * {@code snapshotStatus} — статус открытой строки истории (all_tasks) на
     * момент выгрузки: второй, независимый источник для сверки.
     */
    public record TaskRecord(String uid, String sprintId, String title, String componentId,
                             List<Version> versions, String snapshotStatus) {}

    /** Релиз, связанный со спринтом ребром IMPLEMENTED_IN_RELEASE; у релиза есть только дата. */
    public record Release(String uid, LocalDate date) {}

    public record Sprint(String id, String name, List<String> projects, List<String> components,
                         List<String> milestones, Instant created, Instant done, List<Release> releases) {}

    /**
     * Событие §1: (элемент, вид, момент, кто). {@code at} — момент UTC, если он
     * известен; иначе {@code day} — местный день записи «только дата» (релиз,
     * создание ADR/решения). Время не выдумывается.
     */
    public record Event(String type, String el, String kind, Instant at, LocalDate day,
                        String who, Boolean agent,
                        List<String> projects, List<String> components, String sprint,
                        List<String> milestones, String parent,
                        String fromStatus, String toStatus, String title, String src) {

        public String elKey() { return type + ":" + el; }

        public Event withAuthor(String w, Boolean a) {
            return new Event(type, el, kind, at, day, w, a, projects, components, sprint, milestones,
                parent, fromStatus, toStatus, title, src);
        }

        public Event withProjects(List<String> p) {
            return new Event(type, el, kind, at, day, who, agent, p, components, sprint, milestones,
                parent, fromStatus, toStatus, title, src);
        }
    }

    /** Текущее состояние знания (ADR / решение / спека) — для очереди §7.3. */
    public record Knowledge(String type, String id, String status, LocalDate created, String parent,
                            String version, List<String> projects) {}

    /**
     * Источник, который не удалось прочитать (S7A-07: «источник недоступен» ≠
     * «ничего не было»). {@code critical} — без него метрики раздела не считаются
     * вовсе и отдаются как «не смогли посчитать», а не нулями.
     */
    public record SourceError(String source, String error, boolean critical) {}

    /**
     * Фильтры и разрез запроса (S7A-02). Пустое множество/null — «без фильтра».
     * {@code els} — фильтр по ключам элементов «тип:id»: им клик по числу метрики
     * сужает ленту до тех записей, из которых число сложено (S7A-03).
     */
    public record Query(Set<String> types, Set<String> projects, Set<String> components,
                        Set<String> sprints, Set<String> milestones, Set<String> authors,
                        Set<String> kinds, Set<String> els,
                        String groupBy, String subBy, Integer matrixN, Integer limit,
                        Instant readMark,
                        // S7A-12: «Кто» — точные имена who (мультивыбор, как project); null — без фильтра.
                        Set<String> whos) {
        /** Прежняя форма без who — для вызовов, которым фильтр «Кто» не нужен. */
        public Query(Set<String> types, Set<String> projects, Set<String> components,
                     Set<String> sprints, Set<String> milestones, Set<String> authors,
                     Set<String> kinds, Set<String> els,
                     String groupBy, String subBy, Integer matrixN, Integer limit, Instant readMark) {
            this(types, projects, components, sprints, milestones, authors, kinds, els,
                groupBy, subBy, matrixN, limit, readMark, null);
        }
        public static Query none() {
            return new Query(null, null, null, null, null, null, null, null, "project", null, null, null, null, null);
        }
    }

    /**
     * Вход движка. Период {@code [t0, t1)}; {@code zone} — часовой пояс местного
     * дня (§4, по умолчанию Europe/Moscow). {@code otherEvents} — уже
     * нормализованные события нетаскового происхождения (спринт, релиз, ADR,
     * решение, спека); события задач движок строит сам из цепочек версий, чтобы
     * сверка «снимок ↔ события» шла по одному и тому же коду.
     * {@code scope} — разрешённые проекты вызывающего, null = без ограничения.
     */
    public record Input(Instant t0, Instant t1, Instant now, ZoneId zone,
                        List<TaskRecord> tasks, Map<String, Sprint> sprints,
                        List<Event> otherEvents, List<Knowledge> knowledge,
                        List<SourceError> errors, Set<String> scope) {}
}
