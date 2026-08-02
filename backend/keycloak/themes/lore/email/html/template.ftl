<#macro emailLayout>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<#-- Same rationale as aida-root's seer email/html/template.ftl (table +
     inline styles, fixed light theme) — see that file. -->
<body style="margin:0; padding:0; background:#f5f3ee; font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#faf8f3; border:1px solid #d4ccb8; border-radius:8px;">
          <tr>
            <td style="padding:28px 32px 20px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="36" height="36" style="background:#6b7a2a; border-radius:6px; text-align:center; vertical-align:middle;">
                    <span style="font-family:Arial,Helvetica,sans-serif; font-size:18px; font-weight:bold; color:#f5f3ee; line-height:36px;">L</span>
                  </td>
                  <td style="padding-left:10px; font-family:Arial,Helvetica,sans-serif; font-size:16px; font-weight:bold; color:#1e1a12; letter-spacing:0.5px;">
                    LORE GRAPH
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px 32px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#1e1a12;">
              <#nested>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px; border-top:1px solid #d4ccb8; font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#9a8a6e; text-align:center;">
              LORE GRAPH &middot; ${realmName!''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
</#macro>
