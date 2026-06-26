interface Props {
  url: string;
  /** Run ID — нужен для ссылок на ZIP-скачивание */
  runId?: string;
  /** Сводка для подсказки */
  failed?: number;
}

export function ReportFrame({ url, runId, failed }: Props) {
  return (
    <div className="report-wrap">
      <div className="report-toolbar">
        <a href={url} target="_blank" rel="noreferrer">↗ Открыть в новой вкладке</a>
        <span style={{ flex: 1 }} />
        {runId && (
          <>
            <a
              className="dl-btn dl-failures"
              href={`/tyr-api/runs/${runId}/failures.zip`}
              download
              title="Только упавшие: видео, скриншоты, traces, console errors, summary.md — компактно для отдачи разработчику"
            >
              ⬇ Только упавшие{failed ? ` (${failed})` : ''}
            </a>
            <a
              className="dl-btn dl-full"
              href={`/tyr-api/runs/${runId}/download.zip`}
              download
              title="Весь прогон целиком: Allure-отчёт + test-results + meta + stdout (тяжёлый)"
            >
              ⬇ Весь прогон (zip)
            </a>
          </>
        )}
      </div>
      <iframe className="report-frame" src={url} title="Allure report" />
    </div>
  );
}
