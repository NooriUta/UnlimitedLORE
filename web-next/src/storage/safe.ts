// Единственное хранилище браузера v2: localStorage с откатом в память
// (Seiðr-kit, S4-00f). Прямых обращений к localStorage в v2 быть не должно —
// иначе приватный режим снова роняет приложение.
import { createSafeStorage } from '@seidr/kit';

export const storage = createSafeStorage();
