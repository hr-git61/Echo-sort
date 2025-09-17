// タブID -> { course, pageURL, ts }
const courseByTab = new Map();
// URL(文字列) -> { course, ts }
const courseByUrl = new Map();

function sanitize(name, fallback = 'Unknown') {
    const s = (name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    return s || fallback;
}

function isManabaHost(host) {
    return /manaba\.tsukuba\.ac\.jp$/.test(host);
}

// 期限切れエントリを定期掃除（30分以上前を削除）
function gcHints() {
    const now = Date.now();
    const THRESH = 30 * 60 * 1000;

    for (const [tabId, v] of courseByTab) {
        if (now - (v?.ts || 0) > THRESH) courseByTab.delete(tabId);
    }
    for (const [url, v] of courseByUrl) {
        if (now - (v?.ts || 0) > THRESH) courseByUrl.delete(url);
    }
}
setInterval(gcHints, 10 * 60 * 1000);

chrome.tabs.onRemoved.addListener((tabId) => courseByTab.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'SET_COURSE_HINT') {
        const course = sanitize(msg.course);
        const ts = Number(msg.ts || Date.now());

        // タブ紐づけ（sender.tab.id があれば）
        if (sender?.tab?.id != null) {
            courseByTab.set(sender.tab.id, {
                course,
                pageURL: String(msg.pageURL || ''),
                ts
            });
        }

        // URL紐づけ（クリックされたリンクURL）
        if (typeof msg.clickUrl === 'string' && msg.clickUrl) {
            courseByUrl.set(msg.clickUrl, { course, ts });
        }

        sendResponse?.({ ok: true });
    }
    // 非同期レスポンス不要
});

// ダウンロード開始時：保存先パスを決定（ダウンロードフォルダ配下のみ）
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    try {
        const rawUrl = item.url || item.finalUrl || '';
        const u = new URL(rawUrl);
        if (!isManabaHost(u.host)) return;

        // 1) tabId 経由で取得（通常はこちらがヒット）
        let course = courseByTab.get(item.tabId)?.course;

        // 2) ヒットしない場合（tabId === -1 等）は URL 経由で引く
        if (!course) {
            // まず完全一致
            course = courseByUrl.get(rawUrl)?.course;

            // リダイレクト等で finalUrl がある場合も試す
            if (!course && item.finalUrl && item.finalUrl !== rawUrl) {
                course = courseByUrl.get(item.finalUrl)?.course;
            }
        }

        // 見つからなければ Unknown
        course = sanitize(course, 'Unknown');

        // 元ファイル名の決定
        const baseName = sanitize(
            item.filename || u.pathname.split('/').pop() || 'download'
        );

        // manaba/<科目名>/<元ファイル名>
        const relPath = `manaba/${course}/${baseName}`;

        suggest({ filename: relPath, conflictAction: 'uniquify' });
    } catch (e) {
        // 失敗時はデフォルト保存にフォールバック
        console.warn('onDeterminingFilename error:', e, item);
    }
});
