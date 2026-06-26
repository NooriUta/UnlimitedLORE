// TYR — stub placeholder (testing / QA / justice module, TPG runtime)
export default function TyrPage() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        color: 'var(--t3)',
        fontFamily: 'var(--font)',
      }}
    >
      <span style={{ fontSize: 48, opacity: 0.18 }}>⚖</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--t2)', fontFamily: 'var(--display)', letterSpacing: '0.06em' }}>
        TYR
      </span>
      <span style={{ fontSize: 13 }}>Скоро · Тестирование</span>
    </div>
  );
}
