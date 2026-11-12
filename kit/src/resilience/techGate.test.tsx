// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TECH-NOTES — адресат сообщения (audience) и
// механизм скрытия технического. Kit знает только механизм: признак `tech`
// на сообщении, общий выключатель (проп провайдера) и кнопку на месте. ЧТО
// считать техническим, решает приложение и передаёт данными.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { audienceOf, isTech, TechGate, TechVisibilityProvider, useShowTech } from './techGate';

describe('S4-TECH-NOTES · адресат сообщения', () => {
  it('без тега — user: честность по умолчанию сломать нельзя', () => {
    expect(audienceOf(undefined)).toBe('user');
    expect(audienceOf({})).toBe('user');
    expect(audienceOf({ audience: 'что-то' })).toBe('user');
    expect(audienceOf({ audience: 'user' })).toBe('user');
  });
  it('tech — только явным тегом', () => {
    expect(audienceOf({ audience: 'tech' })).toBe('tech');
    expect(isTech({ audience: 'tech' })).toBe(true);
    expect(isTech({})).toBe(false);
  });
});

describe('S4-TECH-NOTES · TechGate', () => {
  it('без провайдера tech скрыт: содержимого нет, есть кнопка «тех.»', () => {
    render(<TechGate><p>relation:x error</p></TechGate>);
    expect(screen.queryByText('relation:x error')).toBeNull();
    const btn = screen.getByRole('button', { name: /техническ/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('кнопка на месте раскрывает только этот блок', () => {
    render(<>
      <TechGate><p>первый</p></TechGate>
      <TechGate><p>второй</p></TechGate>
    </>);
    fireEvent.click(screen.getAllByRole('button', { name: /техническ/i })[0]);
    expect(screen.getByText('первый')).toBeTruthy();
    expect(screen.queryByText('второй')).toBeNull();
  });

  it('скрытое, означающее неполноту, оставляет человеческую строку', () => {
    render(<TechGate hiddenNote="часть сведений не загрузилась"><p>код</p></TechGate>);
    expect(screen.getByText('часть сведений не загрузилась')).toBeTruthy();
    expect(screen.queryByText('код')).toBeNull();
  });

  it('общий выключатель — проп провайдера: всё видно, кнопки и замены нет', () => {
    render(
      <TechVisibilityProvider show>
        <TechGate hiddenNote="замена"><p>код</p></TechGate>
      </TechVisibilityProvider>,
    );
    expect(screen.getByText('код')).toBeTruthy();
    expect(screen.queryByText('замена')).toBeNull();
    expect(screen.queryByRole('button', { name: /техническ/i })).toBeNull();
  });

  it('useShowTech без провайдера — false', () => {
    function Probe() { return <span>{String(useShowTech())}</span>; }
    render(<Probe />);
    expect(screen.getByText('false')).toBeTruthy();
  });

  it('своя подпись: видимый текст и aria-label отличают кнопку от соседнего тех-блока', () => {
    render(<TechGate label="тех. модели"><p>код</p></TechGate>);
    const btn = screen.getByRole('button', { name: /техническ/i });
    expect(btn.textContent).toBe('тех. модели');
    expect(btn.getAttribute('aria-label')).toBe('Показать технические сведения (тех. модели)');
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: /техническ/i }).getAttribute('aria-label'))
      .toBe('Скрыть технические сведения (тех. модели)');
  });

  it('без подписи — прежняя общая «тех.» и общий aria-label', () => {
    render(<TechGate><p>код</p></TechGate>);
    const btn = screen.getByRole('button', { name: /техническ/i });
    expect(btn.textContent).toBe('тех.');
    expect(btn.getAttribute('aria-label')).toBe('Показать технические сведения');
  });
});
