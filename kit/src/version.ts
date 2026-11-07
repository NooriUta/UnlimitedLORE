// Версия выдачи Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-08). Один источник —
// kit/package.json: бандл, витрина и потребители читают её отсюда.
import { version } from '../package.json';

export const SEIDR_KIT_VERSION: string = version;
