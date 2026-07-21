// Экран входа: единственное, что видит человек без действительной сессии.
//
// ПОЧЕМУ ЭКРАН, А НЕ АВТОМАТИЧЕСКИЙ РЕДИРЕКТ. Раньше отсутствие сессии сразу
// уводило в Keycloak. Это плохо ровно в тот момент, когда происходит чаще
// всего — сессия истекла посреди работы: человека выбрасывает со страницы без
// объяснения, а если Keycloak недоступен, он остаётся на чужом домене с
// ошибкой и без пути назад. Осознанный переход по кнопке оставляет его на
// нашей странице, с причиной и адресом, куда он идёт.
//
// Вёрстка намеренно повторяет тему логина Keycloak (backend/keycloak/themes/
// lore): человек нажимает кнопку и попадает на страницу того же вида, а не в
// чужой интерфейс. Расхождение этих двух экранов читается как «меня увели не
// туда» — то есть как фишинг.
import { useState } from 'react';
import { login, wasSessionLost } from './session';

const OIDC_ISSUER = import.meta.env.VITE_OIDC_ISSUER as string | undefined;

/** Хост Keycloak — показываем, куда именно уводит кнопка. */
function issuerHost(): string | null {
  if (!OIDC_ISSUER) return null;
  try {
    return new URL(OIDC_ISSUER).host;
  } catch {
    return null;
  }
}

export default function LoginScreen() {
  const [going, setGoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lost = wasSessionLost();
  const host = issuerHost();

  async function go(): Promise<void> {
    setGoing(true);
    setError(null);
    try {
      await login();
    } catch (e) {
      // signinRedirect() падает, когда Keycloak недоступен или клиент настроен
      // неверно. Молча вернуть кнопку в исходное состояние нельзя: нажатие без
      // видимого результата выглядит как «кнопка не работает», и человек будет
      // жать её снова вместо того, чтобы позвать за помощью.
      setGoing(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 28,
      background: 'var(--bg0)', color: 'var(--t1)', fontFamily: 'var(--font)', padding: 24,
    }}>
      {/* ── Бренд ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, background: 'var(--acc)',
          color: 'var(--bg0)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800,
        }}>L</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, letterSpacing: '0.02em',
          }}>LORE</span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)',
            textTransform: 'uppercase', letterSpacing: '0.12em',
          }}>AIDA · Knowledge</span>
        </div>
      </div>

      {/* ── Карточка ──────────────────────────────────────────────────────── */}
      <div style={{
        width: '100%', maxWidth: 380, background: 'var(--bg1)', border: '1px solid var(--bd)',
        borderRadius: 12, padding: '28px 28px 24px', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            {lost ? 'Сессия истекла' : 'Требуется вход'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.55 }}>
            {lost
              ? 'Срок действия сессии закончился, продлить её автоматически не удалось. Несохранённые изменения на странице могли не отправиться — после входа проверьте их.'
              : 'Чтение и запись в LORE доступны только после входа.'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => { void go(); }}
          disabled={going}
          style={{
            width: '100%', padding: '10px 16px', borderRadius: 6, border: '1px solid var(--acc)',
            background: going ? 'transparent' : 'var(--acc)',
            color: going ? 'var(--t2)' : 'var(--bg0)',
            fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600,
            cursor: going ? 'default' : 'pointer',
          }}
        >
          {going ? 'Переход в Keycloak…' : 'Войти через Keycloak'}
        </button>

        {host && (
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)', textAlign: 'center',
          }}>
            {host}
          </div>
        )}

        {error && (
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.5, color: 'var(--danger)',
            background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
            borderRadius: 6, padding: '8px 10px', wordBreak: 'break-word',
          }}>
            Не удалось начать вход: {error}
          </div>
        )}
      </div>
    </div>
  );
}
