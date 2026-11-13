package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-MACHINE-OBJ — машина в действиях агента.
 *
 * <p><b>Правило (владелица 11.11):</b> мутация под учёткой агента указывает машину
 * своей сессии; вершины машины в графе нет — завести; машин у агента может быть
 * несколько, новая прежнюю не перезаписывает.
 *
 * <p><b>Модель</b> — по поправке 09.11 к ADR-MINILORE-007 и ADR-LORE-041 (связь —
 * ребром, не полем): вершина {@code KnowMachine(machine_id)}, ребро
 * {@code KnowActor -USES_MACHINE-> KnowMachine}. Поле {@code KnowActor.machine_id}
 * (AL-108, «откуда писал последний раз», last-write-wins) не трогается — оно другое
 * и остаётся как было.
 *
 * <p><b>Откуда машина.</b> Заголовок {@value #HEADER}: MCP-сервер шлёт его на каждом
 * вызове (LORE_MACHINE_ID → COMPUTERNAME → HOSTNAME → имя хоста). Это самоописание
 * сессии, как {@code machine_id} в {@code actor/session}: прав оно не даёт.
 *
 * <p><b>Мягкий режим по умолчанию.</b> На 11.11 ни один клиент машину в мутациях не
 * шлёт; жёсткий отказ уронил бы всех живых агентов разом. Поэтому без машины запись
 * проходит, но ответ говорит {@code machine_warning} — не молча. Отказ
 * ({@code 400 MACHINE_REQUIRED}) включается флагом {@value #FLAG_REQUIRED}, когда
 * все агенты обновятся.
 *
 * <p>Человека машиной не гейтим: правило — про действия агента.
 */
final class AgentMachine {

    private AgentMachine() {}

    static final String HEADER = "X-Lore-Machine";

    /** Жёсткий режим: мутация агента без машины — отказ. По умолчанию выключен. */
    static final String FLAG_REQUIRED = "lore.agent.machine.required";

    /** Тот же алфавит, что у machineHeader в MCP; без «/» — это имя, не путь. */
    static final Pattern SAFE = Pattern.compile("[A-Za-z0-9_.\\-]{1,64}");

    /** V79: машина — вершина, агент — рёбрами к ней. Аддитивно. */
    static final List<String> SCHEMA_SQL = List.of(
        "CREATE VERTEX TYPE KnowMachine IF NOT EXISTS",
        "CREATE PROPERTY KnowMachine.machine_id IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowMachine.first_seen_at IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowMachine.last_seen_at IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowMachine (machine_id) UNIQUE",
        "CREATE EDGE TYPE USES_MACHINE IF NOT EXISTS"); // KnowActor(agent) -> KnowMachine, multi

    /** Завести машину при отсутствии; last_seen_at — каждый раз. */
    static final String ENSURE_MACHINE_SQL =
        "UPDATE KnowMachine SET machine_id = :m, last_seen_at = :now UPSERT WHERE machine_id = :m";

    /** first_seen_at — только при создании, повтор его не переписывает. */
    static final String FIRST_SEEN_SQL =
        "UPDATE KnowMachine SET first_seen_at = :now WHERE machine_id = :m AND first_seen_at IS NULL";

    /**
     * Привязка агента к машине. IF NOT EXISTS — повтор не плодит рёбер; удаления нет —
     * вторая машина добавляется к первой, а не заменяет её.
     */
    static final String LINK_SQL =
        "CREATE EDGE USES_MACHINE FROM (SELECT FROM KnowActor WHERE client_id = :c) "
        + "TO (SELECT FROM KnowMachine WHERE machine_id = :m) IF NOT EXISTS";

    /** Подтверждение привязки — для кеша «уже привязан» в фильтре. */
    static final String LINKED_SQL =
        "SELECT count(*) AS n FROM USES_MACHINE WHERE @out.client_id = :c AND @in.machine_id = :m";

    static final String WARN_MISSING = "машина не указана: агентская запись пришла без заголовка " + HEADER
        + " — в графе действие не привязано к машине. Обновите MCP-сервер LORE (шлёт заголовок сам) "
        + "или задайте LORE_MACHINE_ID.";

    /**
     * Вердикт по машине для одной мутации.
     *
     * @param machineId принятое имя машины или null
     * @param warning   что сказать в ответе (null — сказать нечего)
     * @param refuse    отказать до записи (только жёсткий режим)
     */
    record Verdict(String machineId, String warning, boolean refuse) {
        static final Verdict NOT_APPLICABLE = new Verdict(null, null, false);
    }

    /**
     * SPRINT_UXR_POLISH_UAT_1113/PU-18: каноническое имя машины — trim + нижний регистр.
     * Заголовок писался как пришёл, и одна машина стала двумя объектами (LorCetus/LORCETUS).
     * Канонизируется на каждом входе: заголовок, заведение, доступ, окно активности, учётка.
     */
    static String canon(String machineId) {
        return machineId == null ? null : machineId.trim().toLowerCase(java.util.Locale.ROOT);
    }

    /**
     * PU-18 шаг 2 (V82): план слияния вершин KnowMachine, чьё имя не каноническое.
     * Ключ — каноническое имя, значение — некононические варианты (по алфавиту), которые
     * в него вливаются. Уже канонические имена в план не попадают — повтор на слитой
     * базе даёт пустой план.
     */
    static Map<String, List<String>> caseMergePlan(java.util.Collection<String> machineIds) {
        Map<String, List<String>> plan = new java.util.TreeMap<>();
        for (String id : machineIds) {
            if (id == null || id.isBlank()) continue;
            String c = canon(id);
            if (c.equals(id)) continue;
            plan.computeIfAbsent(c, k -> new java.util.ArrayList<>()).add(id);
        }
        plan.values().forEach(java.util.Collections::sort);
        return plan;
    }

    static Verdict judge(ChangeAuthor author, String rawHeader, boolean required) {
        if (author == null || !ChangeAuthor.KIND_AGENT.equals(author.kind())) return Verdict.NOT_APPLICABLE;
        String v = rawHeader == null ? "" : rawHeader.trim();
        if (!v.isEmpty() && SAFE.matcher(v).matches()) return new Verdict(canon(v), null, false);
        String warning = v.isEmpty() ? WARN_MISSING
            : "машина не указана: значение " + HEADER + " недопустимо (ожидается [A-Za-z0-9_.-], до 64 символов)"
              + " — в графе действие не привязано к машине.";
        return new Verdict(null, warning, required);
    }

    /** Поля ответа мутации: у агента — machine_id (null, если не указана) и предупреждение. */
    static Map<String, Object> answerFields(Verdict v) {
        if (v == null || (v.machineId() == null && v.warning() == null)) return Map.of();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("machine_id", v.machineId());
        if (v.warning() != null) out.put("machine_warning", v.warning());
        return out;
    }
}
