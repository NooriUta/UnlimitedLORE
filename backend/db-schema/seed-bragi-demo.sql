-- seed-bragi-demo.sql — illustrative demo data for the BRAGI content archive,
-- extracted 1:1 from C:\Маркетинг\bragi-archive-prototype.html (ARC-03).
-- Idempotent-ish: re-running duplicates rows (no UPSERT WHERE here — this is
-- throwaway demo content, not production data). Delete-and-reseed if needed:
--   DELETE FROM BragiPublication WHERE publication_id LIKE 'PUB-%';  (+ variants/assets/etc.)
-- Data is illustrative (per prototype footer: "данные иллюстративные").

-- ── Channels ──────────────────────────────────────────────────────────────
INSERT INTO BragiChannel SET channel_id = 'CH-VC',   channel_type = 'platform', url_handle = 'vc.ru',      funnel_role = 'awareness', rules_md = 'лонгриды, 1 / 1.5-2 нед';
INSERT INTO BragiChannel SET channel_id = 'CH-HABR', channel_type = 'platform', url_handle = 'habr.com',   funnel_role = 'authority',  rules_md = 'техничка, 1 / 2-3 нед';
INSERT INTO BragiChannel SET channel_id = 'CH-TG',   channel_type = 'social',   url_handle = 't.me/seidr', funnel_role = 'nurture',    rules_md = '2 поста/нед (якорь + тёплый)';
INSERT INTO BragiChannel SET channel_id = 'CH-SITE', channel_type = 'owned',    url_handle = 'seidrstudio.pro/blog', funnel_role = 'conversion', rules_md = 'лонгриды после VC/Habr';

-- ── Pages ─────────────────────────────────────────────────────────────────
INSERT INTO BragiPage SET page_id = 'PG-ARCH',     url = '/arch/',                                page_type = 'landing', title = 'Архитектура';
INSERT INTO BragiPage SET page_id = 'PG-LINEAGE',  url = '/blog/data-lineage/',                    page_type = 'article', title = 'Data lineage';
INSERT INTO BragiPage SET page_id = 'PG-WHYLLM',   url = '/blog/why-llm-ast/',                     page_type = 'article', title = 'Text to SQL';
INSERT INTO BragiPage SET page_id = 'PG-AIGOV',    url = '/blog/ai-governance-data-lineage/',      page_type = 'article', title = 'AI governance';
INSERT INTO BragiPage SET page_id = 'PG-DIALECTS', url = '/docs/dialects/',                        page_type = 'docs',    title = 'Диалекты SQL';
INSERT INTO BragiPage SET page_id = 'PG-ROOT',     url = '/',                                      page_type = 'landing', title = 'Главная';

-- ── Keywords ──────────────────────────────────────────────────────────────
INSERT INTO BragiKeyword SET keyword_id = 'KW-01', phrase = 'data governance',              cluster = 'governance', freq_exact = 273, intent = 'инфо', source = 'wordstat';
INSERT INTO BragiKeyword SET keyword_id = 'KW-02', phrase = 'управление данными',            cluster = 'governance', freq_exact = 78,  intent = 'инфо', source = 'wordstat';
INSERT INTO BragiKeyword SET keyword_id = 'KW-03', phrase = 'data lineage',                  cluster = 'lineage',    freq_exact = 57,  intent = 'инфо', source = 'wordstat';
INSERT INTO BragiKeyword SET keyword_id = 'KW-04', phrase = 'text to sql',                   cluster = 'AI',         freq_exact = 37,  intent = 'инфо', source = 'wordstat';
INSERT INTO BragiKeyword SET keyword_id = 'KW-05', phrase = 'AI governance',                 cluster = 'AI',         freq_exact = 36,  intent = 'инфо', source = 'wordstat';
INSERT INTO BragiKeyword SET keyword_id = 'KW-06', phrase = 'каталог данных',                cluster = 'governance', freq_exact = 10,  intent = 'инфо', source = 'wordstat';
INSERT INTO BragiKeyword SET keyword_id = 'KW-07', phrase = 'анализ зависимостей PL/SQL',    cluster = 'lineage',    freq_exact = 0,   intent = 'комм', source = 'wordstat';
INSERT INTO BragiKeyword SET keyword_id = 'KW-08', phrase = 'Сейдр Студия',                  cluster = 'brand',     intent = 'бренд', source = 'yandex-serp';

CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-01') TO (SELECT FROM BragiPage WHERE page_id = 'PG-ARCH');
CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-02') TO (SELECT FROM BragiPage WHERE page_id = 'PG-ARCH');
CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-03') TO (SELECT FROM BragiPage WHERE page_id = 'PG-LINEAGE');
CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-04') TO (SELECT FROM BragiPage WHERE page_id = 'PG-WHYLLM');
CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-05') TO (SELECT FROM BragiPage WHERE page_id = 'PG-AIGOV');
CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-06') TO (SELECT FROM BragiPage WHERE page_id = 'PG-ARCH');
CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-07') TO (SELECT FROM BragiPage WHERE page_id = 'PG-DIALECTS');
CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-08') TO (SELECT FROM BragiPage WHERE page_id = 'PG-ROOT');

-- ── Publications + Variants + Assets ─────────────────────────────────────
INSERT INTO BragiPublication SET publication_id = 'PUB-01', title = 'Data lineage в эпоху ИИ: с чего начинается AI governance', topic = 'AI governance', main_text_md = '(4 500 зн.)', type = 'article', status_general = 'ready';
INSERT INTO BragiVariant SET variant_id = 'PUB-01-VC', text_md = '(оригинал, 4 500 зн.)', status = 'ready', url = 'https://vc.ru/...';
INSERT INTO BragiVariant SET variant_id = 'PUB-01-TG', text_md = '(анонс, 280 зн.)',       status = 'ready';
INSERT INTO BragiAsset SET asset_id = 'AST-01', asset_type = 'cover',   file_url = 'ai-gov.png';
INSERT INTO BragiAsset SET asset_id = 'AST-02', asset_type = 'og-teaser', file_url = 'tg-card.png';
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-01') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-01-VC');
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-01') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-01-TG');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-01-VC') TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-VC');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-01-TG') TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-TG');
CREATE EDGE HAS_ASSET    FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-01-VC') TO (SELECT FROM BragiAsset WHERE asset_id = 'AST-01');
CREATE EDGE HAS_ASSET    FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-01-TG') TO (SELECT FROM BragiAsset WHERE asset_id = 'AST-02');
CREATE EDGE TARGETS_KEY  FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-01') TO (SELECT FROM BragiKeyword WHERE keyword_id = 'KW-05');

INSERT INTO BragiPublication SET publication_id = 'PUB-02', title = 'Инструменты data lineage: сравнение подходов', topic = 'сравнение', main_text_md = '(3 800 зн.)', type = 'article', status_general = 'ready';
INSERT INTO BragiVariant SET variant_id = 'PUB-02-SITE', text_md = '(лонгрид, 3 800 зн.)', status = 'ready', url = 'https://seidrstudio.pro/blog/...';
INSERT INTO BragiVariant SET variant_id = 'PUB-02-TG',   text_md = '(анонс, план)',        status = 'planned';
INSERT INTO BragiAsset SET asset_id = 'AST-03', asset_type = 'cover', file_url = 'cover.png';
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-02') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-02-SITE');
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-02') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-02-TG');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-02-SITE') TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-SITE');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-02-TG')   TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-TG');
CREATE EDGE HAS_ASSET    FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-02-SITE') TO (SELECT FROM BragiAsset WHERE asset_id = 'AST-03');

INSERT INTO BragiPublication SET publication_id = 'PUB-03', title = 'Дедупликация SQL: 5 алгоритмов хэширования', topic = 'техничка', main_text_md = '(6 000 зн.)', type = 'article', status_general = 'draft';
INSERT INTO BragiVariant SET variant_id = 'PUB-03-HABR', text_md = '(оригинал, 6 000 зн.)', status = 'draft', url = null;
INSERT INTO BragiVariant SET variant_id = 'PUB-03-TG',   text_md = '(анонс, план)',         status = 'planned';
INSERT INTO BragiAsset SET asset_id = 'AST-04', asset_type = 'cover', file_url = 'teaser.png';
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-03') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-03-HABR');
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-03') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-03-TG');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-03-HABR') TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-HABR');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-03-TG')   TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-TG');
CREATE EDGE HAS_ASSET    FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-03-HABR') TO (SELECT FROM BragiAsset WHERE asset_id = 'AST-04');

INSERT INTO BragiPublication SET publication_id = 'PUB-04', title = 'ИИ знает структуру таблиц, но не помогает с аналитикой', topic = 'security', main_text_md = '(3 900 зн.)', type = 'article', status_general = 'published';
INSERT INTO BragiVariant SET variant_id = 'PUB-04-VC', text_md = '(оригинал, 3 900 зн.)', status = 'published', url = 'https://vc.ru/...', published_at = '2026-06-27';
INSERT INTO BragiVariant SET variant_id = 'PUB-04-TG', text_md = '(анонс, 320 просм.)',    status = 'published', published_at = '2026-06-27';
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-04') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-04-VC');
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-04') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-04-TG');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-04-VC') TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-VC');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-04-TG') TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-TG');

INSERT INTO BragiPublication SET publication_id = 'PUB-05', title = 'Column-level lineage из SQL', topic = 'техничка', type = 'article', status_general = 'published';
INSERT INTO BragiVariant SET variant_id = 'PUB-05-HABR', text_md = '(оригинал)', status = 'published', published_at = '2026-06-27';
CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id = 'PUB-05') TO (SELECT FROM BragiVariant WHERE variant_id = 'PUB-05-HABR');
CREATE EDGE IN_CHANNEL   FROM (SELECT FROM BragiVariant WHERE variant_id = 'PUB-05-HABR') TO (SELECT FROM BragiChannel WHERE channel_id = 'CH-HABR');

-- ── Competitors (доля в ИИ) ───────────────────────────────────────────────
INSERT INTO BragiCompetitor SET competitor_id = 'COMP-COLLIBRA',  name = 'Collibra';
INSERT INTO BragiCompetitor SET competitor_id = 'COMP-MANTA',     name = 'Manta';
INSERT INTO BragiCompetitor SET competitor_id = 'COMP-ARENADATA', name = 'Arenadata';
INSERT INTO BragiCompetitor SET competitor_id = 'COMP-DATAHUB',   name = 'DataHub';
INSERT INTO BragiCompetitor SET competitor_id = 'COMP-SEIDR',     name = 'Сейдр Студия';

-- ── Insights ──────────────────────────────────────────────────────────────
INSERT INTO BragiInsight SET insight_id = 'INS-01', insight_date = '2026-07-02', statement_md = 'Бренд-запрос уходит тёзке: «Seiðr» (ð) мешает кириллическому матчингу.', evidence_ref = 'срез SERP, 02.07';
INSERT INTO BragiInsight SET insight_id = 'INS-02', insight_date = '2026-06-29', statement_md = 'ИИ-ответы съедают информационные «головы», классический SEO-объём ≈0 → ставка на присутствие в ответах LLM (GEO).', evidence_ref = 'Трекер ИИ 3549 + Wordstat, 29.06';
INSERT INTO BragiInsight SET insight_id = 'INS-03', insight_date = '2026-06-30', statement_md = 'Habr — наш плацдарм в выдаче (#1 по «data lineage инструмент»). Усилить Habr-ритм.', evidence_ref = 'SERP, 30.06';

-- ── Integrations (read/write connectors, secret-by-reference only) ───────
INSERT INTO BragiIntegration SET integration_id = 'INT-METRIKA',     service = 'Яндекс.Метрика 110154828',  purpose = 'read',       status = 'active',      secret_ref = 'env:METRIKA_TOKEN';
INSERT INTO BragiIntegration SET integration_id = 'INT-KEYSSO-MON',  service = 'Keys.so Мониторинг 5769',   purpose = 'read',       status = 'active',      secret_ref = 'env:KEYSSO_KEY';
INSERT INTO BragiIntegration SET integration_id = 'INT-KEYSSO-AI',   service = 'Keys.so Трекер ИИ 3549',    purpose = 'read',       status = 'active',      secret_ref = 'env:KEYSSO_KEY';
INSERT INTO BragiIntegration SET integration_id = 'INT-GSC',         service = 'GSC · Яндекс Вебмастер',    purpose = 'read',       status = 'active',      secret_ref = 'oauth:gsc';
INSERT INTO BragiIntegration SET integration_id = 'INT-TG-BOT',      service = 'Telegram Bot',              purpose = 'read/write', status = 'needs_admin', secret_ref = 'vault:TG_BOT';
INSERT INTO BragiIntegration SET integration_id = 'INT-TELEGRAPH',   service = 'Telegraph',                 purpose = 'write',      status = 'active',      secret_ref = 'vault:seidr-telegraph';

-- ── Metrics (MetricSnapshot, TIMESERIES) — illustrative points only ──────
INSERT INTO MetricSnapshot SET ts = 1782561600000, object_type = 'variant', object_id = 'PUB-04-VC', metric = 'views',    value = 2900, source = 'yandex-metrika', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782561600000, object_type = 'publication', object_id = 'PUB-04', metric = 'clicks',   value = 41,   source = 'yandex-metrika', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782561600000, object_type = 'publication', object_id = 'PUB-04', metric = 'demo_conv', value = 3,    source = 'yandex-metrika', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782561600000, object_type = 'variant', object_id = 'PUB-04-TG', metric = 'views',    value = 320,  source = 'tg-stats', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782561600000, object_type = 'variant', object_id = 'PUB-05-HABR', metric = 'views',  value = 1200, source = 'habr-stats', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782561600000, object_type = 'publication', object_id = 'PUB-05', metric = 'clicks',   value = 22,   source = 'yandex-metrika', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782561600000, object_type = 'publication', object_id = 'PUB-05', metric = 'demo_conv', value = 1,    source = 'yandex-metrika', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782982800000, object_type = 'keyword', object_id = 'KW-08', metric = 'position', value = 2, source = 'yandex-serp', segment = 'brand';
INSERT INTO MetricSnapshot SET ts = 1782982800000, object_type = 'competitor', object_id = 'COMP-COLLIBRA',  metric = 'ai_share', value = 34, source = 'ai-tracker-3549', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782982800000, object_type = 'competitor', object_id = 'COMP-MANTA',     metric = 'ai_share', value = 21, source = 'ai-tracker-3549', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782982800000, object_type = 'competitor', object_id = 'COMP-ARENADATA', metric = 'ai_share', value = 15, source = 'ai-tracker-3549', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782982800000, object_type = 'competitor', object_id = 'COMP-DATAHUB',   metric = 'ai_share', value = 12, source = 'ai-tracker-3549', segment = 'none';
INSERT INTO MetricSnapshot SET ts = 1782982800000, object_type = 'competitor', object_id = 'COMP-SEIDR',     metric = 'ai_share', value = 8,  source = 'ai-tracker-3549', segment = 'none';
