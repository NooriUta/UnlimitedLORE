// bragiValidators — VAL-01: live "checks" engine for the BRAGI publication
// editor, ported from the reference prototype's checks(text, v) function
// (C:\Маркетинг\bragi-platform-render-prototype.html). Reads structural
// limits/style rules from BragiChannel.rules_md (VAL-00) instead of
// hardcoding them, so a newly-seeded channel gets validation for free.
import type { BragiSkin } from './BragiSkinPreview';

export interface ValidationIssue {
  level: 'warn' | 'info';
  message: string;
}

interface ChannelLimits {
  caption?: number;
  post?: number;
  poll_option?: number;
}

// rules_md is free-text markdown, not a strict schema — pull out the first
// integer following each known limit keyword. Matches formats like
// "caption_limit: 1024" and "- caption: 1024" interchangeably.
export function parseChannelLimits(rulesMd: string | null | undefined): ChannelLimits {
  const out: ChannelLimits = {};
  if (!rulesMd) return out;
  // Matches both "post_limit: 4096" (key + optional trailing word chars/colon)
  // and "- caption: 1024" (key immediately followed by colon) — the trailing
  // "[a-z_]*" absorbs a "_limit" suffix of any length before the digits.
  const grab = (key: string): number | undefined => {
    const m = rulesMd.match(new RegExp(key + '[a-z_]*[:\\-]?\\s*(\\d+)', 'i'));
    return m ? parseInt(m[1], 10) : undefined;
  };
  out.caption = grab('caption');
  out.post = grab('post');
  out.poll_option = grab('poll[_ ]?option');
  return out;
}

/** The single char-limit that applies to the active skin's counter, if any. */
export function activeCharLimit(skin: BragiSkin, rulesMd: string | null | undefined): number | undefined {
  if (skin !== 'tg') return undefined;
  const { post, caption } = parseChannelLimits(rulesMd);
  return post ?? caption;
}

/** Platform-rule checks against the rendered skin + text (REN-00/VAL-00 inputs). */
export function validateSkin(skin: BragiSkin, textMd: string, rulesMd: string | null | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const text = textMd || '';
  const len = text.length;

  if (skin === 'tg') {
    const { post, caption } = parseChannelLimits(rulesMd);
    const limit = post ?? caption;
    if (limit && len > limit) {
      issues.push({ level: 'warn', message: `превышен лимит TG: ${len.toLocaleString('ru')}/${limit.toLocaleString('ru')} зн` });
    }
  }

  if (skin === 'vc') {
    const links = text.match(/\]\(https?:\/\/[^)]+\)/g) ?? [];
    if (links.length > 1) {
      issues.push({ level: 'warn', message: `${links.length} ссылок в теле — VC: одна футер-ссылка` });
    }
    const seidrLinksNoUtm = links.filter(l => /seidrstudio\.pro/i.test(l) && !/utm_/i.test(l));
    if (seidrLinksNoUtm.length > 0) {
      issues.push({ level: 'warn', message: 'ссылка на seidrstudio.pro без UTM-метки' });
    }
  }

  if (skin === 'habr') {
    const fences = (text.match(/```/g) ?? []).length;
    if (fences % 2 !== 0) {
      issues.push({ level: 'warn', message: 'незакрытый код-блок (```)' });
    }
  }

  if (skin === 'tgraph') {
    if (/<script|<style/i.test(text)) {
      issues.push({ level: 'warn', message: 'Telegraph: без CSS/JS в теле' });
    }
  }

  return issues;
}

/** Satellite-variant checks that need surrounding context (status/date/URL,
 * whether it diverges from main). Independent of skin/platform rules. */
export function validateVariant(v: {
  text_md: string; sameAsMain: boolean; status: string; url: string; published_at: string;
}, mainText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (v.status !== 'draft' && !v.published_at) {
    issues.push({ level: 'info', message: 'нет даты' });
  }
  if (v.status === 'published' && !v.url.trim()) {
    issues.push({ level: 'warn', message: 'published без URL' });
  }
  if (!v.sameAsMain && v.text_md.trim() && mainText.trim() && v.text_md.trim() === mainText.trim()) {
    issues.push({ level: 'info', message: 'текст дублирует main → включи наследование' });
  }
  return issues;
}
