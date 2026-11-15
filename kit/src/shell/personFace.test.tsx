// @vitest-environment jsdom
// AP-07 «аватары доделать» (владелица 15.11.2026, SPRINT_LORE_ADMIN_POLISH/AP-07): лицо человека —
// одно на весь kit. Есть картинка — картинка; нет или не загрузилась — инициалы; нет и имени —
// значок «человек». Картинку (src) даёт приложение: kit не знает, как её получить с токеном.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AvatarMenu, PersonFace } from './index';

describe('PersonFace — лицо человека', () => {
  it('есть src — картинка с подписью имени', () => {
    render(<PersonFace name="Ольга Летописец" src="blob:x" />);
    const img = screen.getByRole('img', { name: 'Ольга Летописец' }) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('blob:x');
  });

  it('src нет — инициалы (положительный контроль)', () => {
    const { container } = render(<PersonFace name="Ольга Летописец" />);
    expect(container.textContent).toBe('ОЛ');
  });

  it('картинка не загрузилась — инициалы, а не битый значок', () => {
    const { container } = render(<PersonFace name="Ольга Летописец" src="blob:broken" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('ОЛ');
  });
});

describe('AvatarMenu — свой аватар в шапке', () => {
  it('avatarSrc задан — в кнопке картинка, а не инициалы', () => {
    const { container } = render(<AvatarMenu name="Ольга Летописец" avatarSrc="blob:me" />);
    const btn = container.querySelector('button.sk-avatar')!;
    expect(btn.querySelector('img')?.getAttribute('src')).toBe('blob:me');
    expect(btn.textContent).toBe('');
  });

  it('avatarSrc нет — инициалы, как раньше', () => {
    const { container } = render(<AvatarMenu name="Ольга Летописец" />);
    expect(container.querySelector('button.sk-avatar')!.textContent).toBe('ОЛ');
  });
});
