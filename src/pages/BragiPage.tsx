// BRAGI — stub placeholder (narrative / docs / skald module)
export default function BragiPage() {
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
      <span style={{ fontSize: 48, opacity: 0.18 }}>✍</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--t2)', fontFamily: 'var(--display)', letterSpacing: '0.06em' }}>
        BRAGI
      </span>
      <span style={{ fontSize: 13 }}>Скоро</span>
    </div>
  );
}
