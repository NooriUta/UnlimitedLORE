// Единственное хранилище браузера v2: localStorage с откатом в память
// (Seiðr-kit, S4-00f). Прямых обращений к localStorage в v2 быть не должно —
// иначе приватный режим снова роняет приложение.
import { createSafeStorage } from '@seidr/kit';

export const storage = createSafeStorage();

// Хранилище на одну вкладку (sessionStorage) с тем же откатом в память
// (S4-STALE-CHUNK): метка «уже перезагружались из-за устаревшего чанка».
// Откат в память здесь честно виден по persistent=false — и тогда
// перезагрузку вслепую не делают (метка её бы не пережила — петля).
export const sessionStore = createSafeStorage(() => globalThis.sessionStorage);
