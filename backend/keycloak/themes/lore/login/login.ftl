<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=(realm.password && realm.registrationAllowed && !registrationDisabled??); section>
  <#if section = "form">

    <form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">

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

  </#if>
</@layout.registrationLayout>
