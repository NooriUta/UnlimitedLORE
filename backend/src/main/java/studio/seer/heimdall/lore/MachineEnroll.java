package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-MACH-1 — программное заведение машины miniLORE (пробел OWN-1).
 *
 * <p><b>Заметка задачи (11.11):</b> «Нужна программная дверь: MCP-инструмент … или REST-эндпоинт,
 * эквивалентный форме админки «Агенты» (имя, учётка=client_id, machine_id, владелец, harness).
 * Права: полная роль (или admin), журналирование. Критерий: демон/сессия заводит машину одним
 * вызовом (без админки), машина видна в срезе agent_owners с заполненным machine_id и client_id
 * minilore-link-&lt;machineId&gt;».
 *
 * <p><b>Машина</b> — {@code KnowActor(kind=agent, client_id = minilore-link-<machine>)} с ребром
 * {@code OWNED_BY} на владельца (ADR-MINILORE-007 В4), плюс вершина-наблюдение {@code KnowMachine}
 * и рёбра {@code USES_MACHINE} от машины и от агентов того же владельца на ней.
 *
 * <p><b>Кто заводит и на кого</b> ({@link #owner}): admin — на любого; человек — только себе;
 * агент — только профиль full и только СВОЕМУ владельцу. Последнее — граница AL-83: агент не
 * выбирает владельца (иначе завёл бы машину на человека с более широкими правами); машина
 * получает ровно ту цепочку прав, что уже есть у вызывающего агента.
 *
 * <p><b>Чужое не переписывается</b> ({@link #conflict}): машина с другим владельцем или имя, занятое
 * агентом другого владельца, — отказ с именем владельца (как мастер «Новый ноутбук», S7B-17).
 * Перепривязка владельца — отдельный путь {@code actor/owner} (machine_owner_set, только человек).
 */
final class MachineEnroll {

    private MachineEnroll() {}

    record Request(String machine_id, String kc_sub, String harness, String name, String profile, Boolean dry_run) {
        Request { machine_id = AgentMachine.canon(machine_id); }   // PU-18: одна машина — один объект
    }

    static String requestError(Request r, List<String> allowedHarnesses) {
        if (r == null) return "body required";
        if (r.machine_id() == null || r.machine_id().isBlank()) return "machine_id required — имя машины, например «lorcetus»";
        if (!AgentMachine.SAFE.matcher(r.machine_id()).matches())
            return "machine_id недопустим (ожидается [A-Za-z0-9_.-], до 64 символов)";
        if (r.machine_id().startsWith(MachineAccess.PREFIX))
            return "machine_id — имя машины без префикса учётки: «" + r.machine_id().substring(MachineAccess.PREFIX.length())
                + "», учётка станет " + r.machine_id();
        if (r.kc_sub() != null && !LoreResourceBase.SAFE_ID.matcher(r.kc_sub()).matches())
            return "kc_sub contains illegal characters";
        if (r.harness() != null && !r.harness().isEmpty() && !allowedHarnesses.contains(r.harness()))
            return "harness: '" + r.harness() + "' нет в справочнике harness " + allowedHarnesses;
        if (r.profile() != null && !r.profile().isEmpty() && !LoreResourceBase.SAFE_ID.matcher(r.profile()).matches())
            return "profile contains illegal characters";
        if (r.name() != null && r.name().length() > 200) return "name: не длиннее 200 символов";
        return null;
    }

    // ── кто заводит и на кого ─────────────────────────────────────────────

    /** @param agentOwnerSub владелец вызывающего агента (OWNED_BY его учётки); у человека — null */
    record Caller(String agentScope, String seerRole, String kcSub, String agentOwnerSub) {}

    /** Владелец новой машины либо отказ: {@code status} 400 (не на кого) | 403 (нельзя). */
    record Owner(String kcSub, String refusal, int status) {
        static Owner of(String sub) { return new Owner(sub, null, 200); }
        static Owner refuse(int status, String why) { return new Owner(null, why, status); }
    }

    static Owner owner(Caller c, String asked) {
        String want = asked == null || asked.isBlank() ? null : asked;
        if (c.agentScope() != null) {
            if (!"full".equals(c.agentScope()))
                return Owner.refuse(403, "агент профиля " + c.agentScope() + " машины не заводит — только full (или человек: владелец себе, admin любому)");
            if (c.agentOwnerSub() == null || c.agentOwnerSub().isBlank())
                return Owner.refuse(403, "у вызывающего агента нет владельца в графе (OWNED_BY) — машину заводить не на кого");
            if (want != null && !want.equals(c.agentOwnerSub()))
                return Owner.refuse(403, "агент заводит машину только своему владельцу (" + c.agentOwnerSub()
                    + "), не " + want + ": иначе агент выдал бы права в обход владельца (AL-83)");
            return Owner.of(c.agentOwnerSub());
        }
        boolean admin = "admin".equals(c.seerRole()) || "superadmin".equals(c.seerRole());
        if (admin) {
            String sub = want != null ? want : c.kcSub();
            return sub == null ? Owner.refuse(400, "kc_sub required — чья это машина") : Owner.of(sub);
        }
        if (c.kcSub() == null) return Owner.refuse(403, "нет личности: машину человек заводит себе по своему kc_sub, другим — admin");
        if (want != null && !want.equals(c.kcSub()))
            return Owner.refuse(403, "машину на другого человека заводит только admin");
        return Owner.of(c.kcSub());
    }

    // ── что уже есть в графе ──────────────────────────────────────────────

    /** Актор с учёткой машины, если уже заведён. */
    record Existing(String actorId, String kind, List<String> ownerSubs, String ownerName, String harness, String name) {
        Existing {
            ownerSubs = ownerSubs == null ? List.of() : List.copyOf(ownerSubs);
        }
    }

    /** Агент, у которого {@code machine_id} — это имя (кроме самой машины). */
    record Neighbour(String actorId, String clientId, List<String> ownerSubs, String ownerName) {
        Neighbour {
            ownerSubs = ownerSubs == null ? List.of() : List.copyOf(ownerSubs);
        }
    }

    /** Почему завести нельзя (409) либо null. */
    static String conflict(String machineId, String owner, Existing ex, List<Neighbour> neighbours, boolean admin) {
        String client = MachineAccess.clientIdOf(machineId);
        if (ex != null) {
            if (!"agent".equals(ex.kind()))
                return "актор " + ex.actorId() + " с учёткой " + client + " уже есть, но он не агент (kind=" + ex.kind() + ")";
            if (!ex.ownerSubs().isEmpty() && !ex.ownerSubs().contains(owner))
                return "машина " + machineId + " уже заведена, её владелец — " + nameOr(ex.ownerName(), ex.ownerSubs())
                    + ". Перепривязать владельца — machine_owner_set (только человек)";
            if (ex.ownerSubs().isEmpty() && !admin)
                return "машина " + machineId + " заведена без владельца — привязать её может только admin";
        }
        for (Neighbour n : neighbours == null ? List.<Neighbour>of() : neighbours) {
            if (client.equals(n.clientId())) continue;
            if (n.clientId() != null && n.clientId().startsWith(MachineAccess.PREFIX))
                return "имя " + machineId + " уже у машины " + n.actorId() + " — две машины с одним именем не допускаются (S7B-16)";
            if (!n.ownerSubs().isEmpty() && !n.ownerSubs().contains(owner))
                return "имя машины " + machineId + " занято: на ней агент " + n.actorId() + " владельца "
                    + nameOr(n.ownerName(), n.ownerSubs());
        }
        return null;
    }

    private static String nameOr(String name, List<String> subs) {
        return name != null && !name.isBlank() ? name : String.join(", ", subs);
    }

    /** Агенты того же владельца на этой машине — их привязать к ней ребром USES_MACHINE. */
    static List<String> linkable(List<Neighbour> neighbours, String machineId, String owner) {
        List<String> out = new ArrayList<>();
        for (Neighbour n : neighbours == null ? List.<Neighbour>of() : neighbours) {
            if (n.clientId() != null && n.clientId().startsWith(MachineAccess.PREFIX)) continue;
            if (n.ownerSubs().contains(owner)) out.add(n.actorId());
        }
        return out;
    }

    // ── план ──────────────────────────────────────────────────────────────

    /** «Было → станет»: kind = create | update | unchanged. harness не назван — не трогаем. */
    static Map<String, Object> plan(Existing ex, Request r, String owner) {
        String client = MachineAccess.clientIdOf(r.machine_id());
        String harness = r.harness() != null ? (r.harness().isEmpty() ? null : r.harness()) : ex == null ? null : ex.harness();
        String name = r.name() != null && !r.name().isBlank() ? r.name() : ex != null && ex.name() != null ? ex.name() : client;
        Map<String, Object> after = new LinkedHashMap<>();
        after.put("actor_id", ex == null ? client : ex.actorId());
        after.put("client_id", client);
        after.put("machine_id", r.machine_id());
        after.put("owner_kc_sub", owner);
        after.put("harness", harness);
        after.put("name", name);
        Map<String, Object> p = new LinkedHashMap<>();
        String kind;
        if (ex == null) kind = "create";
        else if (ex.ownerSubs().isEmpty() || !Objects.equals(ex.harness(), harness) || !Objects.equals(ex.name(), name)) kind = "update";
        else kind = "unchanged";
        p.put("kind", kind);
        if (ex != null) {
            Map<String, Object> before = new LinkedHashMap<>();
            before.put("actor_id", ex.actorId());
            before.put("owner_kc_sub", ex.ownerSubs().isEmpty() ? null : ex.ownerSubs().get(0));
            before.put("harness", ex.harness());
            before.put("name", ex.name());
            p.put("before", before);
        } else p.put("before", null);
        p.put("after", after);
        return p;
    }
}
