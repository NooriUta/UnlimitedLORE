// LORE v2 — оболочка нового веба (SPRINT_UXR_S3_V2_INFRA/S3-01).
// Пока только каркас: каталог, сборка и образ. Навигация и экраны v2 приходят
// своими задачами UXR; v1 (корневой src/) заморожен и отсюда не импортируется.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/unbounded/800.css';
import './styles/tokens.css';
import { PersonalSettings } from './settings/PersonalSettings';

export default function App() {
  return (
    <>
      <main data-lore-app="v2" className="shell">
        <h1 className="shell-title">LORE</h1>
        <span className="shell-tag">v2</span>
      </main>
      {/* S3-07: личные настройки — переход v2 → v1 по флагу «новая навигация». */}
      <PersonalSettings />
    </>
  );
}
