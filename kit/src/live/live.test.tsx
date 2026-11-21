// @vitest-environment jsdom
// «Живые» кубики kit (SPRINT_UXR_S15_KIT6): команда с подтверждением, живой регулятор,
// загрузка файла, прослушать звук, плитка показания. Повод — витрина умного дома GLADSHEIM
// на kit (владелица 21.11.2026: «скачай себе kit и доделай»), но кубики общие: kit не знает
// ни «колонки», ни «громкости» — подписи, значения и поведение даёт приложение.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioClip, CommandAck, FileUpload, LiveControl, LiveToggle, StatTile, ackNext, ageKey } from '.';

describe('K6-COMMAND-ACK · команда с подтверждением', () => {
  it('переходы: подтверждение приёма — ещё не «исполнено»; исполнено — только по факту', () => {
    expect(ackNext(ackNext('idle', 'send'), 'ack')).toBe('acked');
    expect(ackNext('acked', 'fact-ok')).toBe('done');
    expect(ackNext('acked', 'fact-bad')).toBe('failed');
    expect(ackNext('sent', 'timeout')).toBe('expired');
    expect(ackNext('done', 'timeout')).toBe('done');
    expect(ackNext('expired', 'send')).toBe('sent');
  });

  it('состояние словами: «подтвердило приём» и «факт не сошёлся» — разные строки', () => {
    const { rerender } = render(<CommandAck label="Перезапустить" state="acked" onSend={() => {}} />);
    expect(screen.getByText(/подтвердило приём/)).toBeTruthy();
    rerender(<CommandAck label="Перезапустить" state="failed" reason="значение прежнее" onSend={() => {}} />);
    expect(screen.getByText(/факт не сошёлся/)).toBeTruthy();
    expect(screen.getByText(/значение прежнее/)).toBeTruthy();
  });

  it('пока команда в пути — кнопка не жмётся второй раз', () => {
    const onSend = vi.fn();
    render(<CommandAck label="Перезапустить" state="sent" onSend={onSend} />);
    const b = screen.getByRole('button', { name: 'Перезапустить' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
  });

  it('из исхода — снова можно отправить', () => {
    const onSend = vi.fn();
    render(<CommandAck label="Перезапустить" state="expired" onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перезапустить' }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('K6-LIVE-CONTROL · живой регулятор', () => {
  it('показывает факт; желаемое, отличное от факта, — «в пути»', () => {
    render(<LiveControl label="Громкость" min={0} max={10} fact={4} wanted={6} onChange={() => {}} />);
    expect(screen.getByText(/факт 4/)).toBeTruthy();
    expect(screen.getByText(/6 в пути/)).toBeTruthy();
  });

  it('сдвиг сразу сообщает значение — без «сохранить»', () => {
    const onChange = vi.fn();
    render(<LiveControl label="Громкость" min={0} max={10} fact={4} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Громкость' }), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it('устройство встало на потолок ниже просьбы — сказано словами', () => {
    render(<LiveControl label="Яркость" min={0} max={100} fact={80} ceiling={80} asked={95} onChange={() => {}} />);
    expect(screen.getByText(/потолок/)).toBeTruthy();
  });

  it('переключатель: в пути — недоступен и так подписан', () => {
    render(<LiveToggle label="Свет" on={false} pending onToggle={() => {}} />);
    expect((screen.getByRole('checkbox', { name: /Свет/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/в пути/)).toBeTruthy();
  });
});

describe('K6-FILE-UPLOAD · загрузка файла', () => {
  const file = (name: string, size: number) => new File([new Uint8Array(size)], name);

  it('не тот тип — отказ до отправки, загрузка не зовётся', async () => {
    const onUpload = vi.fn();
    render(<FileUpload label="Песня" accept=".mp3" maxBytes={1000} onUpload={onUpload} />);
    fireEvent.change(screen.getByLabelText('Песня'), { target: { files: [file('a.wav', 10)] } });
    expect(await screen.findByText(/не тот тип/)).toBeTruthy();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('слишком большой — отказ до отправки', async () => {
    const onUpload = vi.fn();
    render(<FileUpload label="Песня" accept=".mp3" maxBytes={1000} onUpload={onUpload} />);
    fireEvent.change(screen.getByLabelText('Песня'), { target: { files: [file('a.mp3', 5000)] } });
    expect(await screen.findByText(/больше/)).toBeTruthy();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('успех — «загружено»; отказ сервера — его словами', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<FileUpload label="Песня" accept=".mp3" maxBytes={1000} onUpload={ok} />);
    fireEvent.change(screen.getByLabelText('Песня'), { target: { files: [file('a.mp3', 10)] } });
    expect(await screen.findByText(/загружено/)).toBeTruthy();
    unmount();
    const bad = vi.fn().mockRejectedValue(new Error('места на диске нет'));
    render(<FileUpload label="Песня" accept=".mp3" maxBytes={1000} onUpload={bad} />);
    fireEvent.change(screen.getByLabelText('Песня'), { target: { files: [file('a.mp3', 10)] } });
    expect(await screen.findByText(/места на диске нет/)).toBeTruthy();
  });

  it('прогресс от приложения показывается', async () => {
    let report: (pct: number) => void = () => {};
    let finish: () => void = () => {};
    const onUpload = vi.fn((_f: File, onProgress: (pct: number) => void) => { report = onProgress; return new Promise<void>((r) => { finish = r; }); });
    render(<FileUpload label="Песня" accept=".mp3" maxBytes={1000} onUpload={onUpload} />);
    fireEvent.change(screen.getByLabelText('Песня'), { target: { files: [file('a.mp3', 10)] } });
    await waitFor(() => expect(onUpload).toHaveBeenCalled());
    act(() => report(40));
    expect(screen.getByText('40 %')).toBeTruthy();
    await act(async () => finish());
  });
});

describe('K6-AUDIO-CLIP · прослушать звук', () => {
  it('сбой загрузки — словами, а не тишина', () => {
    const { container } = render(<AudioClip src="/no.wav" label="Что услышал дом" />);
    fireEvent.error(container.querySelector('audio')!);
    expect(screen.getByText(/не удалось загрузить/)).toBeTruthy();
  });
});

describe('K6-STAT-TILE · плитка показания', () => {
  it('число и возраст замера', () => {
    render(<StatTile label="Кухня" value={21.4} unit="°C" ageSec={40} />);
    expect(screen.getByText(/21,4|21\.4/)).toBeTruthy();
    expect(screen.getByText(/40 с назад/)).toBeTruthy();
  });

  it('старый замер помечен; нет данных — не ноль', () => {
    const { rerender } = render(<StatTile label="Кабинет" value={23} unit="°C" ageSec={3 * 3600} staleAfterSec={600} />);
    expect(screen.getByText(/устарело/)).toBeTruthy();
    rerender(<StatTile label="Спальня" value={null} unit="°C" ageSec={null} />);
    expect(screen.getByText(/не ноль/)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('возраст — ключ по величине: секунды, минуты, часы', () => {
    expect(ageKey(12)).toEqual(['kit.stat.age.s', 12]);
    expect(ageKey(180)).toEqual(['kit.stat.age.m', 3]);
    expect(ageKey(3 * 3600)).toEqual(['kit.stat.age.h', 3]);
  });
});
