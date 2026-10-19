package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;

/**
 * Обнуление тела ВКЛЮЧЕНО, построчный скоуп ВЫКЛЮЧЕН.
 *
 * <p>Комбинация выбрана намеренно, а не для удобства: она доказывает, что две
 * меры независимы. Пока резолвер разрешённых проектов сам проверял
 * {@code lore.scope.enforce}, обнуление с выключенным построчным скоупом
 * получало {@code null} и молча не делало ничего — код за флагом, который во
 * включённом состоянии не работает. Тот же дефект AL-95 ловил у первой
 * редакции построчного скоупа; здесь он не может повториться незамеченным.
 *
 * <p>Вторая причина держать построчный скоуп выключенным: иначе записи чужого
 * проекта исчезали бы из выдачи целиком, и проверить, что у них обнулено
 * ТЕЛО, стало бы нечем — строки, которой нет, не на что посмотреть.
 */
public class BodyRedactProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of(
            "lore.scope.redact-bodies", "true",
            "lore.scope.enforce", "false");
    }
}
