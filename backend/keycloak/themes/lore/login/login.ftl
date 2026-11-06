<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=(realm.password && realm.registrationAllowed && !registrationDisabled??); section>
  <#if section = "form">

    <form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">

      <#-- AL-SWITCH-USER: экран повторной проверки (живая SSO-сессия + prompt=login)
           прячет поле логина. Без ссылки на перезапуск входа сменить учётку
           отсюда нельзя — в стандартной теме она есть, в нашей пропала. -->
      <#if usernameHidden?? && url.loginRestartFlowUrl??>
        <div class="form-group" id="kc-attempted-user">
          <span>${(auth.attemptedUsername)!''}</span>
          <a id="reset-login" href="${url.loginRestartFlowUrl}">${msg("loreSwitchUser")}</a>
        </div>
      </#if>

      <#if !usernameHidden??>
        <div class="form-group">
          <label for="username">${msg("usernameOrEmail")}</label>
          <input id="username"
                 class="form-control"
                 name="username"
                 value="${(login.username!'')}"
                 type="text"
                 autofocus
                 autocomplete="username"
                 aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
          />
          <#if messagesPerField.existsError('username','password')>
            <span id="input-error" aria-live="polite">
              ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
            </span>
          </#if>
        </div>
      </#if>

      <div class="form-group">
        <label for="password">${msg("password")}</label>
        <input id="password"
               class="form-control"
               name="password"
               type="password"
               autocomplete="current-password"
               aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
        />
      </div>

      <#if realm.rememberMe && !usernameHidden??>
        <div class="form-group" style="flex-direction: row; align-items: center; gap: 8px;">
          <input tabindex="3" id="rememberMe" name="rememberMe" type="checkbox" <#if login.rememberMe??>checked</#if> />
          <label for="rememberMe" style="margin: 0;">${msg("rememberMe")}</label>
        </div>
      </#if>

      <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if> />

      <button type="submit" id="kc-login" name="login" class="btn btn-primary">
        ${msg("doLogIn")}
      </button>

      <#if realm.resetPasswordAllowed>
        <div id="kc-form-options" style="text-align: right; margin-top: 12px;">
          <a tabindex="6" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
        </div>
      </#if>
    </form>

    <#-- Внешние провайдеры входа (брокеринг omilore→seer, decision:D-2026-REALM-BROKERING-SEER-OMILORE,
         06.11.2026). Стандартная тема Keycloak рисует их секцией "socialProviders", но template.ftl
         этой темы такую секцию не вызывает — поэтому блок стоит здесь, внутри form. Без провайдеров
         не рисуется вовсе. Подпись берётся из провайдера (displayName, «Войти через AIDA» задана в
         самом Keycloak) — текст в теме не дублируется, иначе два места разойдутся.
         Блок подготовила сессия Völva (C:/AIDA/tmp-scripts/kc-theme-idp-block/README.md). -->
    <#if realm.password && social?? && social.providers?has_content>
      <div id="kc-social-providers" style="margin-top: 20px;">
        <#list social.providers as p>
          <a id="social-${p.alias}" class="btn btn-primary" href="${p.loginUrl}"
             style="display: block; text-align: center; margin-top: 8px;">${p.displayName!p.alias}</a>
        </#list>
      </div>
    </#if>

  </#if>
</@layout.registrationLayout>
