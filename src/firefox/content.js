if (typeof browser === 'undefined' && typeof chrome !== 'undefined') { var browser = chrome; }

// #coursename から科目名を取得（無ければ title）
function getCourseNameFromDOM() {
    const el = document.querySelector('#coursename');
    const raw = (el?.textContent || document.title || 'Unknown').trim();
    return raw.replace(/[\\/:*?"<>|]/g, '_');
}

// a[href] クリックを横取りして自前ダウンロードに切り替える
document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    if (!/manaba\.tsukuba\.ac\.jp$/.test(location.host)) return;

    // 左クリック、修飾なし、同一タブ遷移的なクリックのみ対象（必要に応じて調整）
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    // 絶対URL化
    let url;
    try { url = new URL(a.getAttribute('href'), location.href).toString(); }
    catch { return; }

    // ダウンロード対象らしいリンクだけを拾いたければここでパターン判定を追加
    // 例: if (!/download|file|material/i.test(new URL(url).pathname)) return;

    e.preventDefault(); // ここが重要：ブラウザ標準のダウンロードを止める

    const course = getCourseNameFromDOM();
    const base = (a.getAttribute('download') || new URL(url).pathname.split('/').pop() || 'download')
        .replace(/[\\/:*?"<>|]/g, '_');

    // 背景へ依頼
    browser.runtime.sendMessage({
        type: 'DOWNLOAD_BY_BG',
        url,
        filename: `manaba/${course}/${base}`
    }).catch(() => { });
}, true);
