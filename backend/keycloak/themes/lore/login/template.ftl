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
      var theme = 'dark', palette = '';
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

  <link rel="icon" href="${url.resourcesPath}/img/favicon.ico" type="image/x-icon" />

  <#if properties.styles?has_content>
    <#list properties.styles?split(' ') as style>
      <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
    </#list>
  </#if>
</head>
<body class="${properties.kcBodyClass!} login-pf">
<div class="login-pf-page">

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
      <span class="sub">Knowledge</span>
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
    HEIMÐALLR · ${.now?string("yyyy")} · ${(realm.name)!''}
  </div>
</div>
</body>
</html>
</#macro>
