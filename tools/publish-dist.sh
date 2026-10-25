#!/bin/zsh
# 天気の知らせボット（gas/）を、配布用シートの Apps Script に送る（clasp）。
#
#   tools/publish-dist.sh        … 送る（gas/.clasp.json の scriptId に。.clasp.json は git に入れない）
#
# 決まり
# - 手元に未コミットの変更があれば送らない（配布用シートが、いつもどれかのコミットと同じになるように）
# - テストが通らなければ送らない
# - 送るのは gas/ の .gs と appsscript.json だけ（一時フォルダにそろえてから送る）
# - スクリプト プロパティ（鍵）は送らない。配布用シートのスクリプト プロパティは空のままにする
set -e
REPO="${0:A:h:h}"
cd "$REPO"
[[ -f gas/.clasp.json ]] || { echo "❌ gas/.clasp.json がありません（gas/.clasp.json.example を写して、配布用シートのスクリプト ID を入れる）"; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "❌ 未コミットの変更があります（コミットしてから送る）"; exit 1; }
node --test test/ >/dev/null || { echo "❌ テストが通りません（npm test）"; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp gas/*.gs gas/appsscript.json "$TMP/"
python3 -c "import json;d=json.load(open('gas/.clasp.json'));json.dump({'scriptId':d['scriptId'],'rootDir':'.'},open('$TMP/.clasp.json','w'))"
(cd "$TMP" && clasp push --force >/dev/null)
echo "✅ 配布用シートに送りました（$(git log -1 --format=%h)・$(ls "$TMP"/*.gs | wc -l | tr -d ' ') ファイル）"
