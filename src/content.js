// ページDOMから #coursename を取得（無ければ document.title をフォールバック）
function getCourseNameFromDOM() {
    const el = document.querySelector('#coursename');
    const raw = (el?.textContent || document.title || 'Unknown').trim();
    return raw.replace(/[\\/:*?"<>|]/g, '_');
}

// クリックされた a[href] の絶対URLを取得
function getAbsoluteHref(a) {
    try {
        return new URL(a.getAttribute('href'), location.href).toString();
    } catch {
        return null;
    }
}

// 「クリックがあったページ」のDOMから科目名を取得し、クリックURLとともにSWへ送る
document.addEventListener(
    'click',
    (e) => {
        const a = e.target.closest('a[href]');
        if (!a) return;

        // クリック元のページ自体が manaba でなければ対象外
        if (!/manaba\.tsukuba\.ac\.jp$/.test(location.host)) return;

        const absUrl = getAbsoluteHref(a);
        if (!absUrl) return;

        // 科目名（クリック時点のページDOMから）
        const course = getCourseNameFromDOM();

        // タブ紐づけとURL紐づけ、両方で引けるよう情報を送る
        chrome.runtime.sendMessage({
            type: 'SET_COURSE_HINT',
            course,
            clickUrl: absUrl,
            pageURL: location.href,
            ts: Date.now()
        });
        // ※ 既定のダウンロード挙動は阻害しない
    },
    true
);
