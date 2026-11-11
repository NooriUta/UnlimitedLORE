package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Срез {@code task_identities} (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24): кого можно поставить
 * автором, исполнителем или принимающим задачи — для выпадающего списка паспорта.
 *
 * <p><b>Одна правда о кандидатах.</b> Коды — ровно {@link TaskRoleWriter#candidates}, тот
 * же список, по которому {@link TaskRoleService#apply} проверяет запись роли и который
 * называет в отказе (TR-05). Отдельный SQL здесь завёл бы вторую правду: форма предлагала
 * бы одно, а сервер отказывал бы по другому.
 *
 * <p>Без БД: факты (люди проекта, заявленные агенты, их имена) собирает
 * {@link TaskRoleService#identitiesOfTask}; здесь только форма строки и порядок.
 */
final class LoreTaskIdentities {

    private LoreTaskIdentities() {}

    static final String SLICE = "task_identities";

    static final String PERSON = "person";
    static final String AGENT = "agent";

    /**
     * Строки {code, title, kind}. Порядок детерминированный: люди, потом агенты; внутри —
     * по подписи без учёта регистра, затем по коду. Совпавшее у человека и агента имя —
     * один кандидат (как в {@code candidates}), и это человек.
     */
    static List<Map<String, Object>> rows(List<String> people, List<String> agents, Map<String, String> agentTitles) {
        List<String> codes = TaskRoleWriter.candidates(people, agents);
        List<Map<String, Object>> out = new ArrayList<>();
        for (String code : codes) {
            boolean person = people.contains(code);
            String title = person ? code : agentTitles.getOrDefault(code, code);
            if (title == null || title.isBlank()) title = code;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", code);
            m.put("title", title);
            m.put("kind", person ? PERSON : AGENT);
            out.add(m);
        }
        out.sort(Comparator
            .comparing((Map<String, Object> m) -> PERSON.equals(m.get("kind")) ? 0 : 1)
            .thenComparing(m -> (String) m.get("title"), String.CASE_INSENSITIVE_ORDER)
            .thenComparing(m -> (String) m.get("title"))
            .thenComparing(m -> (String) m.get("code")));
        return out;
    }

    /**
     * Почему список не строится — по строкам SQL-части среза (задача под скоупом и её проекты).
     * Нет задачи — {@code TASK_NOT_FOUND}; у задачи нет проекта (спринт без проекта) —
     * {@code TASK_PROJECT_NOT_FOUND}. Пустой список в обоих случаях был бы неправдой:
     * «выбрать некого» неотличимо от «не смогли узнать, кого».
     */
    static String problem(List<?> taskRows) {
        if (taskRows == null || taskRows.isEmpty()) return "TASK_NOT_FOUND";
        Object row = taskRows.get(0);
        if (!(row instanceof Map<?, ?> m)) return "TASK_NOT_FOUND";
        Object p = m.get("projects");
        boolean has = p instanceof Collection<?> c ? c.stream().anyMatch(x -> x != null && !String.valueOf(x).isBlank())
            : p != null && !String.valueOf(p).isBlank();
        return has ? null : "TASK_PROJECT_NOT_FOUND";
    }

    static String problemDetail(String problem, String taskUid) {
        return "TASK_NOT_FOUND".equals(problem)
            ? "задачи " + taskUid + " нет. Задача пишется как 'СПРИНТ/КОД' — одинокий код принадлежит многим спринтам сразу."
            : "у задачи " + taskUid + " не найден проект (её спринт не привязан к проекту) — заявленных личностей "
                + "проекта назвать нельзя. Чинится привязкой спринта к проекту, а не выбором другого имени.";
    }
}
