<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false displayWide=false showAnotherWayIfPresent=true>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}" lang="${(locale.currentLanguageTag)!'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="robots" content="noindex, nofollow">
  <title>${msg("loginTitleHtml", (realm.displayNameHtml!''))!'Sign in'}</title>

  <script>
    (function() {
      var theme = 'light', palette = '';
      try {
        var m = document.cookie.match(/(?:^|; )seer-prefs=([^;]*)/);
        if (m) {
          var p = JSON.parse(decodeURIComponent(m[1]));
          if (p.theme)   theme   = p.theme;
          if (p.palette) palette = p.palette;
        }
      } catch(e) {}
      document.documentElement.setAttribute('data-theme', theme);
      if (palette && palette !== 'amber-forest') {
        document.documentElement.setAttribute('data-palette', palette);
      }
    })();
  </script>

  <#-- href set from JS below — resources/img/favicon.ico doesn't exist in this
       theme, and a static file couldn't follow the picker's theme/palette
       anyway. Same "S"-style mark as .seer-mark, generated as an inline SVG. -->
  <link rel="icon" id="seer-favicon" type="image/svg+xml" />

  <#if properties.styles?has_content>
    <#list properties.styles?split(' ') as style>
      <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
    </#list>
  </#if>
</head>
<body class="${properties.kcBodyClass!} login-pf">
<div class="login-pf-page">

  <#-- ── Background illustration (shared platform artwork, same as seer) ──── -->
  <div class="seer-illustration" aria-hidden="true">
    <#include "volva-illustration.ftl">
  </div>

  <#-- ── Style picker (top-left): theme + palette, writes back to seer-prefs ── -->
  <div class="seer-style-picker" id="seer-style-picker">
    <button type="button" class="seer-style-picker__theme" id="seer-theme-toggle" aria-label="toggle theme">
      <svg id="seer-theme-icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="display:none"><path fill="currentColor" d="M320.063 19.72c-72.258 14.575-19.248 71.693-74.344 108.81c4.846-.49 9.746-.702 14.655-.624c16.288.26 32.785 3.72 48.594 10.72a126 126 0 0 1 14.25 7.405c12.107-47.476-37.103-96.38-3.158-126.31zM136.75 44.47c-40.76 61.357 36.984 64.33 24.406 129.405c17.407-21.255 41.17-35.9 67.156-42.313c-25.006-42.138-94.4-41.924-91.562-87.093zm297.313 75.405c-32.547.872-45.475 46.314-96.594 36.22c21.35 17.42 36.034 41.25 42.467 67.31c42.306-24.92 42.053-94.466 87.282-91.624c-13.43-8.92-24.06-12.15-33.158-11.905zm-177.97 26.656c-23.656.46-46.53 8.82-64.906 23.626l18.657 36.156L170 193.156a107.6 107.6 0 0 0-9.406 16.938c-8.726 19.708-11.002 40.59-7.78 60.344l44.78 2.125l-34 30.312c10.798 20.622 28.414 37.852 51.406 48.03a108 108 0 0 0 9.313 3.626l24.53-38.25l9.095 43.814c27.3.075 53.737-10.387 73.593-29.188l-19.186-37.125l38.406 12.658a109 109 0 0 0 5.03-9.938c9.746-22.01 11.457-45.498 6.44-67.22l-37.626-1.75l27.687-24.718c-10.83-20.194-28.236-37.07-50.874-47.093a107 107 0 0 0-4.125-1.72l-25.874 40.313l-9.906-47.75c-.5-.016-1-.023-1.5-.032c-1.3-.02-2.61-.024-3.906 0zM133.407 186.5c-41.652.725-82.483 34.847-108.72 5.094c14.573 72.234 71.664 19.3 108.783 74.312c-2.154-20.972.934-42.758 10.06-63.375a126 126 0 0 1 7.345-14.093c-5.822-1.47-11.642-2.038-17.47-1.937zm249.5 53.97a124.65 124.65 0 0 1-10.03 63.624l-.188.375a126 126 0 0 1-7.22 13.78c47.524 12.244 96.507-37.137 126.47-3.156c-14.603-72.388-71.92-19.04-109.032-74.625zM136.53 283.405c-42.123 25.014-41.928 94.37-87.093 91.53c61.422 40.803 64.322-37.123 129.594-24.342c-21.344-17.385-36.03-41.167-42.5-67.188zm219.064 48.906c-17.406 21.46-41.236 36.24-67.344 42.72c24.944 42.263 94.497 42.004 91.656 87.218c40.867-61.52-37.402-64.358-24.312-129.938M193.406 360.72c-12.047 47.456 37.087 96.33 3.156 126.25c72.305-14.587 19.195-71.79 74.47-108.908c-21.04 2.204-42.898-.9-63.594-10.062a126 126 0 0 1-14.032-7.28"/></svg>
      <svg id="seer-theme-icon-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="display:none"><path fill="currentColor" d="M255.6 62.21c-25.1 0-50.7 5.02-75.3 15.48C81.74 119.5 35.86 233.1 77.69 331.7c4.76 11.1 10.45 21.7 16.93 31.5c-12.6.3-23.45-.5-31.98-2.4c-13.22-2.9-19.93-7.8-22.27-13.3c-2.33-5.6-1.25-13.8 5.87-25.4c1.65-2.6 3.62-5.4 5.86-8.4c-2.1-7.4-3.76-14.7-5.05-22.2c-6.62 7.1-12.1 14.2-16.37 21.1c-8.74 14.1-12.66 28.9-7.11 42c5.54 13.1 18.9 20.5 35.17 24c13.66 3 30.13 3.6 48.96 2.2c53.2 63.4 143.6 87.6 223.9 53.4c80.3-34.1 125.6-115.7 117.1-198.1c14.1-12.6 25.2-24.9 32.5-36.8c8.9-14.2 12.7-29 7.2-42c-5.6-13.1-18.9-20.5-35.2-24.1c-7.9-1.7-16.9-2.7-26.5-2.8c4.5 6.1 8.6 12.4 12.4 19.1c3.7.4 7.1.9 10.1 1.6c13.3 2.8 20 7.8 22.3 13.3c2.4 5.5 1.3 13.8-5.9 25.3c-4.5 7.4-11.4 15.8-20.4 24.7c1.5 7.3 2.7 14.5 3.4 21.7c-2.6 2.3-5.5 4.7-8.2 7.1c-4.7 3.8-9.5 7.7-14.7 11.5c11.2 32-4.4 67.8-35.9 81.2c-26.3 11.2-56 3.6-74-16.8c-9.1 4.3-18.3 8.4-27.8 12.5c-62.5 26.4-122.4 43-169.2 48.1c-3.8.4-7.5.7-11 1.1c-4.7-5.6-8.95-11.4-13.12-17.6c6.82-.2 14.22-.7 22.02-1.6c44.4-4.9 103-20.9 164.2-46.9c8.4-3.5 16.7-7.3 24.8-11c-.4-.7-.7-1.4-1-2.1c-14-32.9 1.5-71.2 34.4-85.1c28.3-12.1 60.7-2.1 78 21.8c4-3.1 7.9-6.1 11.5-9.1c6.1-5 11.6-10 16.6-14.8c-2.6-11.5-6.2-22.9-11-34.1c-31.4-73.9-103.1-118.22-178.6-118.09M364.3 229.6c-5.9 0-12.1 1.2-18.1 3.7c-23.7 10.1-34.8 37.3-24.6 61.2c10 23.8 37.3 34.7 61.1 24.6c23.7-10 34.8-37.3 24.6-61.1c-7.5-17.9-24.7-28.5-43-28.4"/></svg>
    </button>
    <div class="seer-style-picker__palettes" role="group" aria-label="palette">
      <button type="button" class="seer-style-picker__swatch" data-palette-choice="amber-forest" data-acc-dark="#A8B860" data-acc-light="#6b7a2a" data-bg0-dark="#141108" data-bg0-light="#f5f3ee" title="amber forest"></button>
      <button type="button" class="seer-style-picker__swatch" data-palette-choice="lichen" data-acc-dark="#7ab87c" data-acc-light="#3a7040" data-bg0-dark="#0b0e0c" data-bg0-light="#eff5ef" title="lichen"></button>
      <button type="button" class="seer-style-picker__swatch" data-palette-choice="slate" data-acc-dark="#7890c8" data-acc-light="#3858a8" data-bg0-dark="#0c0e12" data-bg0-light="#eff1f8" title="slate"></button>
      <button type="button" class="seer-style-picker__swatch" data-palette-choice="juniper" data-acc-dark="#6ab89a" data-acc-light="#2a7860" data-bg0-dark="#08100e" data-bg0-light="#edf5f1" title="juniper"></button>
    </div>
  </div>
  <script>
    (function() {
      function cookieDomain() {
        var h = location.hostname;
        if (!h || h === 'localhost' || h.indexOf('.') === -1 || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return '';
        return '; Domain=.' + h;
      }
      function readPrefs() {
        var m = document.cookie.match(/(?:^|; )seer-prefs=([^;]*)/);
        if (!m) return {};
        try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return {}; }
      }
      function writePrefs(prefs) {
        document.cookie = 'seer-prefs=' + encodeURIComponent(JSON.stringify(prefs)) +
          '; Path=/; Max-Age=31536000; SameSite=Lax' + cookieDomain();
      }
      var currentTheme = 'light';
      var currentPalette = 'amber-forest';

      function currentSwatch() {
        return document.querySelector('.seer-style-picker__swatch[data-palette-choice="' + currentPalette + '"]');
      }
      function currentAccent() {
        return currentSwatch().getAttribute(currentTheme === 'dark' ? 'data-acc-dark' : 'data-acc-light');
      }
      function currentBg0() {
        return currentSwatch().getAttribute(currentTheme === 'dark' ? 'data-bg0-dark' : 'data-bg0-light');
      }
      function refreshSubmitButton() {
        var acc = currentAccent();
        document.querySelectorAll('.btn-primary, #kc-login, input[type="submit"]').forEach(function(el) {
          el.style.backgroundColor = acc;
        });
      }
      function refreshFavicon() {
        var acc = currentAccent(), bg0 = currentBg0();
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
          '<rect width="64" height="64" rx="14" fill="' + acc + '"/>' +
          '<text x="32" y="32" text-anchor="middle" dominant-baseline="central" ' +
          'font-family="sans-serif" font-weight="800" font-size="34" fill="' + bg0 + '">L</text></svg>';
        document.getElementById('seer-favicon').setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
      }
      function applyTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        document.getElementById('seer-theme-icon-sun').style.display = theme === 'dark' ? '' : 'none';
        document.getElementById('seer-theme-icon-moon').style.display = theme === 'dark' ? 'none' : '';
        document.querySelectorAll('.seer-style-picker__swatch').forEach(function(btn) {
          btn.style.background = btn.getAttribute(theme === 'dark' ? 'data-acc-dark' : 'data-acc-light');
        });
        refreshSubmitButton();
        refreshFavicon();
      }
      function applyPalette(palette) {
        currentPalette = palette || 'amber-forest';
        if (palette && palette !== 'amber-forest') {
          document.documentElement.setAttribute('data-palette', palette);
        } else {
          document.documentElement.removeAttribute('data-palette');
        }
        document.querySelectorAll('.seer-style-picker__swatch').forEach(function(btn) {
          btn.setAttribute('data-active', String(btn.getAttribute('data-palette-choice') === currentPalette));
        });
        refreshSubmitButton();
        refreshFavicon();
      }

      var prefs = readPrefs();
      applyTheme(document.documentElement.getAttribute('data-theme') || prefs.theme || 'light');
      applyPalette(document.documentElement.getAttribute('data-palette') || prefs.palette || 'amber-forest');

      document.getElementById('seer-theme-toggle').addEventListener('click', function() {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        var current = readPrefs();
        current.theme = next;
        writePrefs(current);
        applyTheme(next);
      });
      document.querySelectorAll('.seer-style-picker__swatch').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var next = btn.getAttribute('data-palette-choice');
          var current = readPrefs();
          current.palette = next;
          writePrefs(current);
          applyPalette(next);
        });
      });
    })();
  </script>

  <#if realm.internationalizationEnabled?? && realm.internationalizationEnabled && locale?? && locale.supported?? && locale.supported?size gt 1>
    <div id="kc-locale">
      <#list locale.supported as l>
        <a href="${l.url}" lang="${l.languageTag}">${l.label}</a>
      </#list>
    </div>
  </#if>

  <div class="seer-brand">
    <div class="seer-mark"><span>L</span></div>
    <div class="seer-wordmark">
      <span class="dot"></span>
      <span class="name">LORE</span>
      <#-- НЕ «Knowledge»: строкой ниже уже идёт AIDA · PLATFORM · KNOWLEDGE,
           и слово повторялось дважды в одном блоке из четырёх строк. -->
      <span class="sub">Graph</span>
    </div>
    <div class="seer-slogan" id="seer-slogan"></div>
    <div class="seer-platform">AIDA · PLATFORM · KNOWLEDGE</div>
  </div>

  <script>
    (function() {
      var lang = (document.documentElement.lang || 'en').split('-')[0];
      var SLOGANS = {
        en: [
          "Every decision keeps its reason.",
          "Not documentation — memory.",
          "Lore is what survives the people who wrote it.",
          "ADRs, sprints, releases — one thread.",
          "The graph remembers what the chat forgets."
        ],
        ru: [
          "У каждого решения остаётся его причина.",
          "Не документация — память.",
          "Знание переживает тех, кто его записал.",
          "ADR, спринты, релизы — одной нитью.",
          "Граф помнит то, что забывает переписка."
        ]
      };
      var pool = SLOGANS[lang] || SLOGANS.en;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      var el = document.getElementById('seer-slogan');
      if (el) el.textContent = pick;
    })();
  </script>

  <div class="card-pf">
    <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
      <div class="alert alert-${message.type} pf-c-alert pf-m-${message.type}">
        <span class="kc-feedback-text">${kcSanitize(message.summary)?no_esc}</span>
      </div>
    </#if>

    <#nested "form">

    <#if auth?has_content && auth.showTryAnotherWayLink() && showAnotherWayIfPresent>
      <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
        <div>
          <input type="hidden" name="tryAnotherWay" value="on"/>
          <a href="#" id="try-another-way" onclick="document.forms['kc-select-try-another-way-form'].submit();return false;">${msg("doTryAnotherWay")}</a>
        </div>
      </form>
    </#if>

    <#nested "info">
  </div>

  <div class="seer-footer">
    LORE · ${.now?string("yyyy")} · ${(realm.name)!''}
  </div>
</div>
</body>
</html>
</#macro>
