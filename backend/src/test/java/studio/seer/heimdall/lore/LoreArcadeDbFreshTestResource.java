package studio.seer.heimdall.lore;

/**
 * Режим «чистая база» (SPRINT_LORE_PIPELINE_HOST/PL-01): ВСЕГДА drop + create +
 * bootstrap + migrate, как до переиспользования схемы, и после него «схема
 * готова» сброшено — следующий класс тоже пойдёт fresh.
 *
 * <p>Для классов, которые сами меняют схему или реестр версий (DROP/CREATE
 * PROPERTY, CREATE/DROP TYPE, DROP INDEX, правка LoreSchemaVersion, прямой
 * вызов шагов миграций) или доказывают именно fresh-путь. Их следы в схеме
 * очистка данных не снимает, и соседний класс увидел бы чужую схему.
 */
public class LoreArcadeDbFreshTestResource extends LoreArcadeDbTestResource {
    @Override
    boolean forceFresh() { return true; }
}
