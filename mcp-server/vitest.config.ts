// Свой конфиг Vitest у mcp-server: без него Vitest поднимается к корневому
// vite.config.ts UI-приложения и наследует его проекты (jsdom, рендер-setup из
// корневого src/test). Сервер MCP — node-код, его тесты идут только в node.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
