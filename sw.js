// 電波がなくても、一度開いたページは開けるようにする（中身は Q キットの line-share/shared/sw-core.js）。
// 天気（Open-Meteo）はここでは扱わない。前の結果は app.js が端末（localStorage）に覚えて出す
// 読まれるところ：index.html の最後で登録する
self.Q_TOOL = "soraqru"; // Q キットの sw-core.js が読む名前
importScripts("/line-share/shared/sw-core.js");
