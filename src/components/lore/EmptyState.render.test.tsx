import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderUi } from '../../test/render';
import { EmptyState, LoadError, SliceLoadWarning } from './EmptyState';

// S0-05: честные пустые состояния — «пусто» и «не смогли загрузить» рисуются по-разному.
describe('EmptyState / LoadError (render)', () => {
  it('пустота — без role=alert, сбой — с role=alert и кнопкой повтора', () => {
    const onRetry = vi.fn();
    renderUi(<>
      <EmptyState message="Записей нет" hint="подсказка" />
      <LoadError text="HTTP 403" onRetry={onRetry} retryLabel="Повторить" />
    </>);
    expect(screen.getByText('Записей нет')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('HTTP 403');
    expect(alert).not.toHaveTextContent('Записей нет');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('SliceLoadWarning перечисляет упавшие срезы и молчит, когда их нет', () => {
    const { container, rerender } = renderUi(<SliceLoadWarning failed={{}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SliceLoadWarning failed={{ sprints: '500' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('sprints: 500');
  });
});
