import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import LorePage from './pages/LorePage';
import BenchmarkPage from './pages/BenchmarkPage';
import SubstratePage from './pages/SubstratePage';
import HypothesisPage from './pages/HypothesisPage';
import FindingPage from './pages/FindingPage';
import ReferencesPage from './pages/ReferencesPage';
import BragiPage from './pages/BragiPage';
import './styles/tokens.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/lore?section=plan" replace />} />
        <Route element={<AppShell />}>
          <Route path="/lore/*" element={<LorePage />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
          <Route path="/benchmark/substrate/:id" element={<SubstratePage />} />
          <Route path="/benchmark/hypothesis/:id" element={<HypothesisPage />} />
          <Route path="/benchmark/finding/:id" element={<FindingPage />} />
          <Route path="/benchmark/references" element={<ReferencesPage />} />
          <Route path="/bragi/*" element={<BragiPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
