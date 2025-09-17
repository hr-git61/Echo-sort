if (typeof browser === 'undefined' && typeof chrome !== 'undefined') { var browser = chrome; }

function sanitizePath(p) {
    return (p || 'download').replace(/^\.+|[\\:*?"<>|]/g, '_').replace(/\/{2,}/g, '/');
}

browser.runtime.onMessage.addListener((msg, _sender) => {
    if (msg?.type !== 'DOWNLOAD_BY_BG') return;

    const url = msg.url;
    let filename = sanitizePath(msg.filename);

    // downloads.download は「ダウンロードフォルダ配下の相対パス」を受け付ける（サブディレクトリ自動作成）
    // Firefox/Chromeともにこの使い方は可。
    // 参考: MDN downloads.download（filename/headers/credentials挙動）
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download

    browser.downloads.download({
        url,
        filename,               // 例: "manaba/科目名/xxx.pdf"
        conflictAction: 'uniquify',
        saveAs: false           // ダイアログを出さない
    }).catch(err => {
        console.warn('downloads.download failed:', err, url, filename);
    });

    // FirefoxのonMessageは戻り値不要
    return false;
});
