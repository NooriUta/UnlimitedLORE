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
import { mantineTheme } from './ui/mantineTheme';
// Порядок импортов значим: стили Mantine идут ПЕРЕД tokens.css, чтобы наши
// токены оставались последним словом. Обратный порядок отдал бы победу
// библиотеке — той самой лотереей «кто позже в бандле», из-за которой TYR уже
// не получает своих шрифтов (STYLE-01, п. 1).
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import './styles/tokens.css';

export default function App() {
  return (
    // forceColorScheme="dark": светлой темы у LORE нет, а Mantine по умолчанию
    // слушает системную. Без этого модалка у пользователя со светлой ОС
    // приезжала бы белой поверх тёмного интерфейса.
    <MantineProvider theme={mantineTheme} forceColorScheme="dark">
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
