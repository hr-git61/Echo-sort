chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
  // 同期応答なので return true は不要
});
