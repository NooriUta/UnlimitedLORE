// LORE v2 — оболочка нового веба (SPRINT_UXR_S3_V2_INFRA/S3-01).
// Пока только каркас: каталог, сборка и образ. Навигация и экраны v2 приходят
// своими задачами UXR; v1 (корневой src/) заморожен и отсюда не импортируется.
// Токены, база и элементы — из Seiðr-kit (D-2026-UXR-KIT-REACT); устойчивость
// (ошибка на экран, плашка хранилища) — S4-00f.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/unbounded/800.css';
import '@seidr/kit/styles/seidr.css';
import './styles/shell.css';
import { ErrorBoundary, StorageBanner } from '@seidr/kit';
import { storage } from './storage';

export default function App() {
  return (
    <ErrorBoundary lang="ru">
      <StorageBanner storage={storage} lang="ru" />
      <main data-lore-app="v2" className="shell">
        <h1 className="shell-title">LORE</h1>
        <span className="shell-tag">v2</span>
      </main>
    </ErrorBoundary>
  );
}
