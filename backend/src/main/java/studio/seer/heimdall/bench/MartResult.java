package studio.seer.heimdall.bench;

import java.util.List;
import java.util.Map;

/**
 * Ответ HTTP-API ArcadeDB (та же форма, что у FriggResponse).
 *
 * <p>Три последних поля — про УСЕЧЕНИЕ, и они необязательные. Сервер
 * приписывает к каждому запросу собственный потолок (замерено: 20000 строк);
 * ключа для него в справочнике настроек нет, поднять конфигурацией нельзя.
 * С 26.8.1 сервер сообщает о срабатывании потолка, до неё — молчал.
 *
 * <p>Раньше запись разбирала ТОЛЬКО {@code result}, и остальные поля
 * отбрасывались при десериализации: даже когда база говорит «я обрезала», код
 * этого не слышал. {@code null} здесь означает «версия не сообщает», а НЕ
 * «усечения не было» — различать это обязан читатель.
 */
public record MartResult(List<Map<String, Object>> result,
                         Integer returned,
                         Integer limit,
                         Boolean truncated) {

    /** Совместимость с местами, где важны только строки. */
    public MartResult(List<Map<String, Object>> result) { this(result, null, null, null); }
}
