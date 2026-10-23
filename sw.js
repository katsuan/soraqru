// 電波がなくても、一度開いたページは開けるようにする（中身は ConneQt 共通の line-share/shared/sw-core.js）。
// 天気（Open-Meteo）はここでは扱わない。前の結果は app.js が端末（localStorage）に覚えて出す
self.CONNEQT_TOOL = "soraqru";
importScripts("/line-share/shared/sw-core.js");
