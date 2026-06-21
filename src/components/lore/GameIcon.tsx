import { Icon } from '@iconify/react';

interface Props {
  slug: string | null | undefined;
  size?: number;
  style?: React.CSSProperties;
}

export function GameIcon({ slug, size = 15, style }: Props) {
  if (!slug) return <span style={{ display: 'inline-block', width: size, height: size }} />;
  return (
    <Icon
      icon={`game-icons:${slug}`}
      width={size}
      height={size}
      style={{ color: 'var(--acc)', flexShrink: 0, ...style }}
    />
  );
}
