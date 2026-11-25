package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * V97 — словарь skill_status и посев первых трёх скиллов (SPRINT_LORE_KNOW_REGISTRY/SKILL-01 + SKILL-03,
 * SPEC-SKILLS-TAGS-062 §5, §11 окно OQ-062-SKILL-SEED).
 *
 * <p>Как V90/V93: только INSERT недостающего, существующее (правленное людьми) не переписывается.
 * Скиллы — процедуры ролей из реальной практики проекта (правила CLAUDE.md проекта, ADR-структура
 * владелицы 08.11.2026); каждый рождается с обязательными рёбрами BELONGS_TO_PROJECT и APPLIES_TO_ROLE,
 * иначе гард висяка нечем проверить. Владелец (OWNED_BY) — владелица ({@link #OWNER_LOGIN}), если её
 * KnowUser есть в базе; на свежей базе ребро не ставится (OWNED_BY необязателен, §6.6).
 */
final class SkillSeed {

    private SkillSeed() {}

    static final String STEP = "java__skill_seed";

    /** Логин владелицы — владелец посевных скиллов (её KnowUser ищется по login, kc_sub на стендах разный). */
    static final String OWNER_LOGIN = "omiloreadmin";

    static final String PROJECT = "NooriUta/UnlimitedLORE";

    static final List<StatusDictCoreSeed.Entry> STATUS_DICT = List.of(
        new StatusDictCoreSeed.Entry("draft", "Черновик", "Draft", "quill-ink", "var(--t3)", 10),
        new StatusDictCoreSeed.Entry("active", "Действует", "Active", "play-button", "var(--suc)", 20),
        new StatusDictCoreSeed.Entry("deprecated", "Снят с поддержки", "Deprecated", "tombstone", "var(--t3)", 30));

    static final Map<String, List<StatusDictCoreSeed.Entry>> DICT_SEEDS = Map.of("skill_status", STATUS_DICT);

    record Skill(String skillId, String name, String title, String version, String status, String source,
                 List<String> projects, List<String> roles, String bodyMd) {}

    static final List<Skill> SKILLS = List.of(
        new Skill("skill:release-cutover", "release-cutover", "Переключение релиза", "1.0.0", "active", "seed",
            List.of(PROJECT), List.of("full"),
            """
            ## Назначение
            Провести пачку изменений по трубе develop → preprod → main и выпустить версию так, чтобы стенд, \
            тег и описание релиза сошлись.

            ## Шаги
            1. Пачка в develop собрана: все PR влиты по зелёному CI (Backend CI и Frontend + MCP).
            2. Промо develop → preprod — из снимка, а не из живой develop: ветка `promote/<ГГГГ-ММ-ДД>-<sha8>` \
            от выбранного коммита; PR в preprod, ждать полный зелёный CI, мерж.
            3. Проверить факт выкатки на стенде по хэшу бандла, а не по коду возврата деплоя.
            4. Пройти изменённые фичи на стенде как пользователь; задачи — в uat, done ставит только человек.
            5. Описание `RELEASE-<tag>.md` — в том же коммите, что получит тег: фичи (спринт/задача + PR, причина \
            и ценность) и апгрейды технологий; CI/CD и внутреннюю кухню не перечислять.
            6. Релиз preprod → main и тег `vX.Y.Z` — только по явному «да» владельца; тег обязан быть в main.

            ## Ограничения
            - Никогда не пушить напрямую в develop, preprod, main.
            - Версию минор/мажор выбирает владелец; без слова — патч.
            - Тег без RELEASE-файла падает намеренно — не обходить.

            ## Ссылки
            CLAUDE.md проекта (Branch flow, Описание релиза), S3-11 «промо фиксирует SHA».
            """),
        new Skill("skill:qg-triage", "qg-triage", "Разбор красного гейта качества", "1.0.0", "active", "seed",
            List.of(PROJECT), List.of("full", "tester"),
            """
            ## Назначение
            Разобрать красный или молчащий гейт качества до корневой причины и записать прогон честно.

            ## Шаги
            1. Прочитать последний прогон гейта и его метрики: NOT_MEASURED — «не смогли проверить», \
            это не PASS и не ноль.
            2. Пустой ответ среза отличить от упавшего запроса: поставить положительный контроль (заведомо \
            существующая запись) прежде, чем объявлять «нарушений нет».
            3. Красный CI сначала проверить на конфиг: порты сервисов, имена секретов, адрес зеркала — \
            большинство «флаки» в проекте были регрессией конфигурации.
            4. Назвать корневую причину (репро, журнал, проба); непроверенное — пометить словом «гипотеза».
            5. Записать прогон: qg_run_log; SKIP — только с типизированной причиной.
            6. Находку — в задачу функции (note_append), новую задачу — только если функции нет.

            ## Ограничения
            - «Flaky» — только после ≥10 прогонов со счётом pass/fail.
            - Блокирующие гейты — только корректность; lint и безопасность — информационные.

            ## Ссылки
            ADR-LORE-053 (QG-рутины канала 2), правила CLAUDE.md «Root Cause First».
            """),
        new Skill("skill:adr-review", "adr-review", "Ревью ADR", "1.0.0", "active", "seed",
            List.of(PROJECT), List.of("full", "architect"),
            """
            ## Назначение
            Проверить ADR до принятия: решение должно быть выбором между ценами, а не пересказом намерения \
            (процедура из skill-proto-adr-writer).

            ## Шаги
            1. Шесть разделов по порядку: Причины, Варианты, Оценка, Выбор, Доказательства, Артефакты. \
            Нет раздела — ADR не готов.
            2. Причины — замер, журнал или репро, а не ощущение.
            3. Варианты — не меньше двух реальных, у каждого цена и что он ломает; «оставить как есть» — \
            законный вариант с названной ценой.
            4. Оценка — таблицей по критериям, названным до выбора и одинаковым для всех вариантов.
            5. Выбор — один вариант и что мы теряем, выбрав его.
            6. Доказательства — проба, журнал, цифры; непроверенное помечено «гипотеза».
            7. Артефакты — диаграмма Mermaid с раскладкой ELK, не список «что было бы на схеме».
            8. Запись — только adr_new; решения-потомки — decision_new с adr_id, по одному на решение.

            ## Ограничения
            - Не переписывать авторский текст ADR без спроса — замечания отдельным списком.

            ## Ссылки
            Правило владелицы 08.11.2026 «ADR — обязательная структура».
            """));

    /** Посевные скиллы, которых ещё нет в базе (по skill_id). */
    static List<Skill> plan(Set<String> existing) {
        List<Skill> out = new ArrayList<>();
        for (Skill s : SKILLS) if (!existing.contains(s.skillId())) out.add(s);
        return out;
    }

    static final String EXISTING_SQL = "SELECT skill_id FROM KnowSkill";

    static final String INSERT_SQL = "INSERT INTO KnowSkill SET skill_id = :skill_id, name = :name, title = :title, "
        + "version = :version, status = :status, source = :source, body_md = :body_md, "
        + "created_at = :now, updated_at = :now";

    static final String ROLE_EDGE_SQL = "CREATE EDGE APPLIES_TO_ROLE FROM (SELECT FROM KnowSkill WHERE skill_id = :skill_id) "
        + "TO (SELECT FROM KnowDictEntry WHERE dict_type = 'agent_profile' AND code = :code)";

    static final String PROJECT_EDGE_SQL = "CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM KnowSkill WHERE skill_id = :skill_id) "
        + "TO (SELECT FROM KnowGitProject WHERE slug = :slug)";

    static final String OWNER_EDGE_SQL = "CREATE EDGE OWNED_BY FROM (SELECT FROM KnowSkill WHERE skill_id = :skill_id) "
        + "TO (SELECT FROM KnowUser WHERE login = :login)";
}
