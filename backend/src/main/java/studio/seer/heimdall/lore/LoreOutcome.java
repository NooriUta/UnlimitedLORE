package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Единый словарь исходов записи (ADR-LORE-043).
 *
 * <p>Ключ {@code ok} отвечает на вопрос «вызов дошёл», а читают его как «работа
 * сделана» — и это не небрежность читателя: другого признака в ответе нет.
 * {@code outcome} называет ПРОИЗОШЕДШЕЕ, и значений ровно столько, сколько
 * различимых исходов бывает.
 *
 * <p><b>{@link #UNCHANGED} и {@link #NOOP} разведены намеренно.</b> «Прислали
 * то же самое» — законный исход идемпотентного вызова, повторять его не надо.
 * «Сделать не удалось» — дефект, и он обязан назвать причину. Слитые в одно
 * (сегодня оба выглядят как {@code ok:true}), они дают ровно ту ошибку, из-за
 * которой шаг миграции отчитался «добавлено 0» и был принят за успешный.
 *
 * <p>Старые ключи ответов НЕ снимаются: {@code outcome} добавляется рядом.
 * Снять их одним заходом значило бы сломать всех читателей ради единообразия —
 * а читатели у ответов разные и правятся не вместе.
 */
final class LoreOutcome {

    private LoreOutcome() {}

    /** Записи/ребра не было — появилась. */
    static final String CREATED = "created";
    /** Было и изменилось. */
    static final String UPDATED = "updated";
    /** Было и снято. */
    static final String DELETED = "deleted";
    /** Было ровно таким же — менять нечего. Законно, не дефект. */
    static final String UNCHANGED = "unchanged";
    /** Не сделано. Обязано нести причину. */
    static final String NOOP = "noop";

    /**
     * Исход связывания.
     *
     * <p>{@code CREATE EDGE … IF NOT EXISTS} возвращает пустой результат в ДВУХ
     * несовместимых случаях: ребро уже было и одного из концов нет вовсе. До
     * сих пор оба давали {@code linked:false} с подсказкой «проверьте, что
     * такие-то существуют» — то есть законную идемпотентность объявляли
     * возможной ошибкой, а настоящую ошибку — возможной нормой.
     *
     * @param edgeCreated вернул ли CREATE EDGE строку
     * @param edgeExists  есть ли ребро СЕЙЧАС (проверять только когда не создано)
     * @param what        чем является цель — для причины отказа
     */
    static Map<String, Object> link(Map<String, Object> base, boolean edgeCreated,
                                    boolean edgeExists, String what) {
        Map<String, Object> out = new LinkedHashMap<>(base);
        if (edgeCreated) {
            out.put("outcome", CREATED);
        } else if (edgeExists) {
            out.put("outcome", UNCHANGED);
            out.put("hint", "связь уже была — повторять вызов не нужно");
        } else {
            out.put("outcome", NOOP);
            out.put("reason", "ребро не создано: " + what + " не найден(ы). "
                + "CREATE EDGE по пустой выборке в ArcadeDB — тихий no-op, "
                + "поэтому отсутствие конца выглядит как успешная запись.");
        }
        return out;
    }

    /** Исход снятия связи. Нечего снимать — это {@link #UNCHANGED}, а не ошибка. */
    static Map<String, Object> unlink(Map<String, Object> base, boolean removed) {
        Map<String, Object> out = new LinkedHashMap<>(base);
        out.put("outcome", removed ? DELETED : UNCHANGED);
        if (!removed) out.put("hint", "такой связи не было — снимать нечего");
        return out;
    }
}
