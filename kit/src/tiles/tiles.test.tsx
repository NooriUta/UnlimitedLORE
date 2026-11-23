// @vitest-environment jsdom
// Плитки показаний и устройств (SPRINT_UXR_S15_KIT6) — пять видов, утверждённых к переносу владелицей 21.11.2026
// («вставь в кит все»): A — капсула с кружком, B — квадрат «включено / спит», C — капсула с заливкой долей шкалы,
// D — карточка группы (комната), E — кольцо-шкала. Плюс Sparkline — мини-линия с разрывом на «нет данных».
// kit не знает ни «температуры», ни «Meteocons»: картинку, цвет вида, подписи и значения даёт приложение.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GroupCard, TileBar, TileGauge, TileRow, TileSquare, tileFraction } from '.';
import { Sparkline, sparkPath } from '../charts/spark';

describe('доля шкалы (для заливки и дуги)', () => {
  it('значение внутри шкалы — доля; за пределами — прижато к 0 и 1; нет значения — null', () => {
    expect(tileFraction(41, [0, 100])).toBeCloseTo(0.41);
    expect(tileFraction(2000, [400, 1500])).toBe(1);
    expect(tileFraction(-5, [0, 100])).toBe(0);
    expect(tileFraction(null, [0, 100])).toBeNull();
  });
});

describe('Sparkline', () => {
  it('пропуск рвёт линию (новый отрезок), а не тянет её к нулю', () => {
    const d = sparkPath([{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: null }, { x: 3, y: 2 }, { x: 4, y: 3 }], 100, 20);
    expect(d.match(/M/g)).toHaveLength(2);
  });
  it('меньше двух точек — ничего не рисует', () => {
    const { container } = render(<Sparkline points={[{ x: 0, y: 1 }]} />);
    expect(container.querySelector('path')).toBeNull();
  });
});

describe('A · TileRow — капсула с кружком', () => {
  it('подпись и значение; оценка помечена звёздочкой и словами для чтения', () => {
    render(<TileRow label="Влажность" value="41 %" icon={<i />} estimate />);
    expect(screen.getByText('Влажность')).toBeTruthy();
    expect(screen.getByText(/41 %/)).toBeTruthy();
    expect(screen.getByTitle(/оценка/)).toBeTruthy();
  });
});

describe('B · TileSquare — включено / спит', () => {
  it('активная и спящая плитки различаются классом (вид — в CSS)', () => {
    const { container, rerender } = render(<TileSquare label="Свет" value="3 из 4" icon={<i />} active />);
    expect(container.firstElementChild!.className).toMatch(/is-on/);
    rerender(<TileSquare label="Свет" value="0 из 1" icon={<i />} active={false} />);
    expect(container.firstElementChild!.className).not.toMatch(/is-on/);
  });
});

describe('C · TileBar — капсула с заливкой', () => {
  it('заливка — доля шкалы; для чтения с экрана — проценты словами', () => {
    const { container } = render(<TileBar label="Влажность" value="41 %" icon={<i />} fraction={0.41} />);
    const fill = container.querySelector('.sk-tilebar__fill') as HTMLElement;
    expect(fill.style.width).toBe('41%');
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('41');
  });
  it('доли нет (значение не пришло) — заливки нет, а не ноль', () => {
    const { container } = render(<TileBar label="CO₂" value="—" icon={<i />} fraction={null} />);
    expect(container.querySelector('.sk-tilebar__fill')).toBeNull();
  });
});

describe('D · GroupCard — карточка группы', () => {
  it('заголовок, главное значение, чипы; пусто — словами приложения', () => {
    render(<GroupCard title="Кухня" main="22,4 °C" chips={[{ key: 'h', icon: <i />, text: '41 %' }]} />);
    expect(screen.getByText('Кухня')).toBeTruthy();
    expect(screen.getByText('22,4 °C')).toBeTruthy();
    expect(screen.getByText('41 %')).toBeTruthy();
  });
  it('без главного значения — пустое состояние, а не ноль', () => {
    render(<GroupCard title="Ванная" main={null} empty="узла нет" chips={[]} />);
    expect(screen.getByText('узла нет')).toBeTruthy();
  });
});

describe('D · GroupCard — фон-картинка (как фото комнат в /app)', () => {
  it('фон ставится картинкой с затемнением, текст поверх читается', () => {
    const { container } = render(<GroupCard title="Кухня" main="22,4 °C" chips={[]} background="/img/kitchen.jpg" />);
    const bg = container.querySelector('.sk-groupcard__photo') as HTMLElement;
    expect(bg.style.backgroundImage).toContain('/img/kitchen.jpg');
    expect(container.firstElementChild!.className).toMatch(/has-photo/);
  });
  it('без картинки — без слоя фона', () => {
    const { container } = render(<GroupCard title="Кухня" main="22,4 °C" chips={[]} />);
    expect(container.querySelector('.sk-groupcard__photo')).toBeNull();
  });
});

describe('D · GroupCard — большая подробная карточка', () => {
  it('подробности приложения показываются под чипами; размер large — классом', () => {
    const { container } = render(<GroupCard title="Гостиная" main="22,6 °C" chips={[]} size="large" details={<ul><li>Люстра · 4 из 5</li></ul>} />);
    expect(screen.getByText('Люстра · 4 из 5')).toBeTruthy();
    expect(container.firstElementChild!.className).toMatch(/sk-groupcard--large/);
  });
});

describe('D · GroupCard — фото полосой сверху, как карточка комнаты в /app', () => {
  it('photo="top" — снимок узкой полосой над текстом, приглушённо', () => {
    const { container } = render(<GroupCard title="Кухня" main="22,4 °C" chips={[]} background="/k.jpg" photo="top" />);
    expect(container.firstElementChild!.className).toMatch(/has-photo-top/);
    expect((container.querySelector('.sk-groupcard__photo') as HTMLElement).style.backgroundImage).toContain('/k.jpg');
  });
});

describe('E · TileGauge — кольцо-шкала', () => {
  it('дуга по доле; тревога — классом; значение в центре', () => {
    const { container } = render(<TileGauge label="CO₂" value="1167" icon={<i />} fraction={0.7} alarm />);
    expect(container.firstElementChild!.className).toMatch(/is-alarm/);
    expect(screen.getByText('1167')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('70');
  });
});

describe('D · GroupCard — показания плашками, тревоги отдельно (разбор дизайнера 22.11: «сенсоры мелкие»)', () => {
  it('показание с value/unit — плашка: число и единица раздельно; тревога — в строке тревог, не среди показаний', () => {
    const { container } = render(<GroupCard title="Гостиная" main="22,6 °C" sub="20,1–24,3 °C · 4 узла" chips={[
      { key: 'h', icon: <i />, value: '43', unit: '%', text: '43 %' },
      { key: 'l', icon: <i />, value: '5/7', unit: '', text: 'свет частично 5/7', title: 'свет частично' },
      { key: 'b', icon: <i />, text: 'не отвечает 1', alarm: true },
    ]} />);
    const plates = container.querySelectorAll('.sk-groupcard__chips .sk-groupcard__plate');
    expect(plates).toHaveLength(2);
    expect(plates[0].querySelector('.sk-groupcard__val')?.textContent).toBe('43');
    expect(plates[0].querySelector('.sk-groupcard__unit')?.textContent).toBe('%');
    expect(plates[1].getAttribute('title')).toBe('свет частично');
    expect(container.querySelector('.sk-groupcard__alerts')?.textContent).toContain('не отвечает 1');
    expect(container.querySelector('.sk-groupcard__chips')?.textContent).not.toContain('не отвечает');
    expect(container.querySelector('.sk-groupcard__sub')?.textContent).toBe('20,1–24,3 °C · 4 узла');
  });
  it('старый вид чипа (только text) рисуется как раньше — совместимость', () => {
    const { container } = render(<GroupCard title="Кухня" main="22,4 °C" chips={[{ key: 'h', icon: <i />, text: '41 %' }]} />);
    expect(container.querySelector('.sk-groupcard__chip')?.textContent).toContain('41 %');
  });
});

describe('D · GroupCard — компактная (разбор дизайнера по комплексным датчикам: Awair, Netatmo, Vindstyrka)', () => {
  it('badge и aside — в шапке; уровень показания красит число; тренд — стрелкой', () => {
    const { container } = render(<GroupCard title="Кухня" main="22,4 °C" badge={<b>воздух хороший</b>} aside={<i>3/4</i>} chips={[
      { key: 'h', icon: <i />, value: '41', unit: '%', text: '41 %', level: 'ok' },
      { key: 'c', icon: <i />, value: '1300', unit: 'ppm', text: 'CO₂', level: 'bad', trend: 'up' },
    ]} />);
    const head = container.querySelector('.sk-groupcard__head')!;
    expect(head.querySelector('.sk-groupcard__badge')?.textContent).toBe('воздух хороший');
    expect(head.querySelector('.sk-groupcard__aside')?.textContent).toBe('3/4');
    const plates = container.querySelectorAll('.sk-groupcard__plate');
    expect(plates[1].classList.contains('is-bad')).toBe(true);
    expect(plates[1].querySelector('.sk-groupcard__trend')?.getAttribute('aria-label')).toMatch(/растёт|rising/);
  });
});

