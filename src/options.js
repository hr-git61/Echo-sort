"use strict";

const SETTINGS_KEY = "echoSortSettings";
const DEFAULTS = { confirmOnCreateCourseDir: true, toastSeconds: 4 };
const hostPattern = /https:\/\/manaba\.tsukuba\.ac\.jp\/?/;

function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({ [SETTINGS_KEY]: DEFAULTS }, (obj) => {
            resolve(obj[SETTINGS_KEY] || DEFAULTS);
        });
    });
}
function setSettings(newVal) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ [SETTINGS_KEY]: newVal }, resolve);
    });
}
function removeSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.remove(SETTINGS_KEY, resolve);
    });
}

// function setBaseStatus(text) {
//     const el = document.getElementById("baseStatus");
//     if (el) el.textContent = "状態: " + text;
// }

// async function sendToActiveManaba(message) {
//     const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
//     const tab = tabs[0];
//     if (!tab || !tab.id || !tab.url || !hostPattern.test(tab.url)) {
//         alert("アクティブな manaba タブを開いてから実行してください。");
//         return;
//     }
//     await chrome.tabs.sendMessage(tab.id, message);
// }

async function init() {
    // 設定の読込
    const s = await getSettings();
    document.getElementById("confirmOnCreate").checked = !!s.confirmOnCreateCourseDir;
    document.getElementById("toastSeconds").value =
        Number.isFinite(s.toastSeconds) ? s.toastSeconds : DEFAULTS.toastSeconds;

    // ベース状態取得
    // setBaseStatus("取得中…");
    // await sendToActiveManaba({ type: "GET_BASE_DIR_STATUS" });

    // イベント登録（インライン禁止のためここで付与）
    // document.getElementById("pickBase").addEventListener("click", async () => {
    //     await sendToActiveManaba({ type: "PICK_BASE_DIR" });
    // });
    // document.getElementById("clearBase").addEventListener("click", async () => {
    //     await sendToActiveManaba({ type: "CLEAR_BASE_DIR" });
    // });
    // document.getElementById("refreshBase").addEventListener("click", async () => {
    //     await sendToActiveManaba({ type: "GET_BASE_DIR_STATUS" });
    // });
    document.getElementById("savePolicy").addEventListener("click", async () => {
        const newVal = {
            confirmOnCreateCourseDir: document.getElementById("confirmOnCreate").checked,
            toastSeconds: Math.max(1, parseInt(document.getElementById("toastSeconds").value, 10) || DEFAULTS.toastSeconds)
        };
        await setSettings(newVal);
        const ss = document.getElementById("saveStatus");
        ss.textContent = "保存しました";
        setTimeout(() => (ss.textContent = ""), 1500);
    });
    document.getElementById("resetSettings").addEventListener("click", async () => {
        await removeSettings();
        const s2 = await getSettings();
        document.getElementById("confirmOnCreate").checked = !!s2.confirmOnCreateCourseDir;
        document.getElementById("toastSeconds").value = s2.toastSeconds;
        const ss = document.getElementById("saveStatus");
        ss.textContent = "設定を初期化しました";
        setTimeout(() => (ss.textContent = ""), 1500);
    });
}

// コンテンツスクリプトからの応答を受け取る
chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;

    // if (msg.type === "BASE_DIR_PICKED") {
    //     if (msg.ok) setBaseStatus(`設定済み（${msg.name}）`);
    //     else setBaseStatus(`未設定（エラー: ${msg.error}）`);
    // } else if (msg.type === "BASE_DIR_STATUS") {
    //     setBaseStatus(msg.has ? `設定済み（${msg.name}）` : "未設定");
    // } else if (msg.type === "BASE_DIR_CLEARED") {
    //     setBaseStatus(msg.ok ? "未設定（クリア済み）" : `未設定（エラー: ${msg.error}）`);
    // }
});

// DOM 準備後に初期化
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
