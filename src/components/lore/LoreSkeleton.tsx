const PULSE_STYLE = `
@keyframes lorePulse {
  0%, 100% { opacity: 0.35; }
  50%       { opacity: 0.7;  }
}
`;

let injected = false;

function injectPulse() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = PULSE_STYLE;
  document.head.appendChild(s);
}

export default function LoreSkeleton({ rows = 5, padding = '8px 12px' }: { rows?: number; padding?: string }) {
  injectPulse();
  return (
    <div style={{ padding, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 30, borderRadius: 4,
            background: 'var(--b2)',
            animation: 'lorePulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 80}ms`,
            width: i % 3 === 2 ? '60%' : i % 3 === 1 ? '80%' : '100%',
          }}
        />
      ))}
    </div>
  );
}
