package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * CI 11.11 (#1225): «CREATE EDGE … IF NOT EXISTS SET …» с параметрами-списками ArcadeDB
 * отверг 400. Свойства допуска пишутся отдельным UPDATE, списки — литералом; здесь —
 * что литерал собран верно и кавычка в значении не рвёт запрос.
 */
class MachineAccessSqlListTest {

    @Test
    void emptyListIsEmptyLiteral() {
        assertEquals("[]", LoreUserResource.sqlList(List.of()));
    }

    @Test
    void valuesAreQuotedAndJoined() {
        assertEquals("['NooriUta/UnlimitedLORE', 'AIDA/miniLORE']",
            LoreUserResource.sqlList(List.of("NooriUta/UnlimitedLORE", "AIDA/miniLORE")));
    }

    @Test
    void quoteAndBackslashAreEscaped() {
        assertEquals("['a\\'b', 'c\\\\d']", LoreUserResource.sqlList(List.of("a'b", "c\\d")));
    }
}
