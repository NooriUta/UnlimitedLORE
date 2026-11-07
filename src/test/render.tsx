// S0-05: рендер с провайдерами приложения (Mantine-тема, роутер в памяти).
// i18n подключается в setup.ts глобально. Обёртка передаётся через `wrapper`,
// поэтому `rerender` из результата сохраняет провайдеры.
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { mantineTheme, mantineCssVariablesResolver } from '../ui/mantineTheme';

export interface RenderUiOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Начальный адрес для MemoryRouter: экраны держат выбор в URL (?dec=, ?passport=). */
  route?: string;
}

export function renderUi(ui: ReactElement, { route = '/', ...opts }: RenderUiOptions = {}): RenderResult {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <MantineProvider theme={mantineTheme} cssVariablesResolver={mantineCssVariablesResolver}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </MantineProvider>
    );
  }
  return render(ui, { wrapper: Providers, ...opts });
}

/**
 * Компонент ничего не нарисовал. `toBeEmptyDOMElement()` на контейнере не годится:
 * MantineProvider кладёт в него свои `<style data-mantine-styles>`, и «пусто» не бывает
 * никогда. Считаем только то, что нарисовал сам компонент.
 */
export function renderedNodes(container: HTMLElement): Element[] {
  return Array.from(container.children).filter(el => !(el.tagName === 'STYLE' && el.hasAttribute('data-mantine-styles')));
}
