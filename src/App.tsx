import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import AuthGate from './auth/AuthGate';
import AuthCallback from './auth/AuthCallback';
import LorePage from './pages/LorePage';
import MuninnPage from './pages/MuninnPage';
import SubstratePage from './pages/SubstratePage';
import HypothesisPage from './pages/HypothesisPage';
import FindingPage from './pages/FindingPage';
import ReferencesPage from './pages/ReferencesPage';
import BragiPage from './pages/BragiPage';
import HuginnPage from './pages/HuginnPage';
import TyrPage from './pages/TyrPage';
import { MantineProvider } from '@mantine/core';
import { mantineTheme, mantineCssVariablesResolver } from './ui/mantineTheme';
// Порядок импортов значим: стили Mantine идут ПЕРЕД tokens.css, чтобы наши
// токены оставались последним словом. Обратный порядок отдал бы победу
// библиотеке — той самой лотереей «кто позже в бандле», из-за которой TYR уже
// не получает своих шрифтов (STYLE-01, п. 1).
// Шрифты — СВОИ файлы, а не расчёт на систему. Токены объявляли `Manrope` и
// `IBM Plex Mono` с самого начала, но ни одного `@font-face` и ни одной ссылки
// на CDN в приложении не было: `document.fonts` на стенде пуст. То есть весь
// интерфейс всегда рисовался системным запасным шрифтом, и «поехало» ровно
// столько раз, сколько разных машин его открывало. Пакеты кладут файлы в
// бандл — вид перестаёт зависеть от того, что стоит у смотрящего, и от
// доступности внешней сети со стенда.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import './styles/tokens.css';

export default function App() {
  return (
    // Схема жёстко тёмная НЕ ставится: светлая тема у LORE есть — переключатель
    // режима живёт в шапке (data-mode на корне). Первая редакция ставила
    // forceColorScheme="dark" по ошибочному допущению «светлой темы нет»; при
    // включённой светлой это давало тёмные переменные Mantine поверх светлого
    // интерфейса.
    //
    // Цвета всё равно приходят из НАШИХ токенов через cssVariablesResolver,
    // поэтому схема Mantine на вид почти не влияет — но пусть она хотя бы не
    // противоречит действительности.
    <MantineProvider theme={mantineTheme} cssVariablesResolver={mantineCssVariablesResolver}>
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<Navigate to="/lore?section=plan" replace />} />
          <Route element={<AppShell />}>
            <Route path="/lore/*" element={<LorePage />} />
            <Route path="/benchmark" element={<MuninnPage />} />
            <Route path="/benchmark/substrate/:id" element={<SubstratePage />} />
            <Route path="/benchmark/hypothesis/:id" element={<HypothesisPage />} />
            <Route path="/benchmark/finding/:id" element={<FindingPage />} />
            <Route path="/benchmark/references" element={<ReferencesPage />} />
            <Route path="/muninn/*" element={<HuginnPage />} />
            <Route path="/tyr/*" element={<TyrPage />} />
            <Route path="/bragi/*" element={<BragiPage />} />
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
    </MantineProvider>
  );
}
