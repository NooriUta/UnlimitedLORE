// Общий вход kit (SPRINT_UXR_S3_V2_INFRA/S3-18): `@seidr/kit/auth`. Отдельная
// точка входа, а не основной index: тянет oidc-client-ts, и приложению без
// входа (витрины, демо) платить за него незачем.
export * from './session';
export * from './oidc';
export * from './AuthGate';
