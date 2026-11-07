// Заглушка bpmn-js для бандла kit/dist (SPRINT_UXR_S10_SEIDR_KIT/K-08).
// bpmn-js — ~1 МБ, single-file HTML за него не платит. Фенс ```bpmn в бандле
// не пропадает молча: MartProse показывает плашку с этой причиной.
export default class NavigatedViewer {
  importXML() {
    return Promise.reject(new Error('диаграммы BPMN не входят в бандл seidr-kit.js — подключите @seidr/kit пакетом'));
  }
  get() { return { zoom() {} }; }
  destroy() {}
}
