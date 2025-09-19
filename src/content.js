// == Echo sort (File System Access API版 / 設定・トースト・日本語名デコード対応) ==
// 保存先: <ベース>/<科目名>/<元ファイル名>
// - ベースは showDirectoryPicker() で取得（IDB に永続化）
// - 新規科目ディレクトリ作成時は設定により confirm
// - 保存成功時はトースト通知
// - オプションページとメッセージ連携（選択/照会/クリア）
// - 日本語名: Content-Disposition の filename* / filename および URL 末尾をデコード
// =======================================================================

"use strict";

/* ==========================
 * 定数・デフォルト設定
 * ========================== */

const DB_NAME = "echo-sort-fsa";
const STORE = "handles"; // IDB: baseDir ハンドル保存
const SETTINGS_KEY = "echoSortSettings"; // chrome.storage.sync: ユーザー設定
const DEFAULT_SETTINGS = {
  confirmOnCreateCourseDir: true,
  toastSeconds: 4,
};
let b = false;
/* ==========================
 * 小物ユーティリティ
 * ========================== */

function sanitize(str, fallback = "Unknown") {
  const s = (str || "").trim().replace(/[\\/:*?"<>|]/g, "_");
  return s || fallback;
}

function getCourseNameFromDOM() {
  const el = document.querySelector("#coursename");
  const raw = (el?.textContent || document.title || "Unknown").trim();
  return sanitize(raw);
}

function getAbsoluteHref(a) {
  try {
    return new URL(a.getAttribute("href"), location.href).toString();
  } catch {
    return null;
  }
}

function looksLikeFileLink(a) {
  if (a.hasAttribute("download")) return true;
  const href = a.getAttribute("href") || "";
  const exts =
    /\.(pdf|zip|docx?|pptx?|xlsx?|csv|png|jpe?g|gif|txt|md|ppt|xls)(\?|#|$)/i;
  if (exts.test(href)) return true;
  if (/download|attach|file/.test(href)) return true;
  return false;
}

/* ==========================
 * 日本語名デコード関連
 * ========================== */

/** 安全な decodeURIComponent（壊れた%エンコードでも落ちない） */
function safeDecodeURIComponent(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** RFC 2047 (= ? charset ? B|Q ? ... ? =) の 1 トークンをデコード */
function decodeRFC2047Token(token) {
  const m = token.match(/^=\?([^?]+)\?([bBqQ])\?([^?]+)\?=$/);
  if (!m) return token;
  const [, charsetRaw, encRaw, data] = m;
  const enc = encRaw.toUpperCase();
  const charset = (charsetRaw || "utf-8").toLowerCase();

  try {
    let bytes;
    if (enc === "B") {
      const bin = atob(data.replace(/\s+/g, ""));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      // Q-encoding
      let s = data.replace(/_/g, " ");
      s = s.replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      );
      bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    }
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  } catch {
    return token;
  }
}

/** 文中の RFC2047 エンコード語を全展開 */
function decodeRFC2047(s) {
  return s.replace(/=\?[^?]+\?[bBqQ]\?[^?]+\?=/g, (t) => decodeRFC2047Token(t));
}

/** Content-Disposition から filename を抽出し、可能な限りデコードして返す */
function getFilenameFromContentDisposition(contentDisposition) {
  if (!contentDisposition) return null;
  const cd = contentDisposition;

  // 1) filename* (RFC 5987) 例: filename*=UTF-8''%E3%81%82.pdf
  const star = cd.match(/filename\*\s*=\s*([^;]+)/i);
  if (star) {
    let v = star[1].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    const parts = v.split("''"); // ["UTF-8","%E3%81%82.pdf"]
    if (parts.length === 2) {
      const encoded = parts[1];
      return safeDecodeURIComponent(encoded);
    }
    if (/%[0-9A-Fa-f]{2}/.test(v)) return safeDecodeURIComponent(v);
    return v;
  }

  // 2) filename= 例: "=?UTF-8?B?...?=" / "report%20日本語.pdf" / "日本語.pdf"
  const plain = cd.match(/filename\s*=\s*([^;]+)/i);
  if (plain) {
    let v = plain[1].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (/=\?[^?]+\?[bBqQ]\?[^?]+\?=/.test(v)) v = decodeRFC2047(v);
    if (/%[0-9A-Fa-f]{2}/.test(v)) v = safeDecodeURIComponent(v);
    return v;
  }

  return null;
}

/* ==========================
 * chrome.storage: 設定
 * ========================== */

async function loadSettings() {
  // （保険）chrome.storage が無い環境でも落ちないようにする
  if (
    typeof chrome === "undefined" ||
    !chrome.storage ||
    !chrome.storage.sync
  ) {
    return { ...DEFAULT_SETTINGS };
  }
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS }, (obj) => {
      const s = obj[SETTINGS_KEY] || DEFAULT_SETTINGS;
      resolve({
        confirmOnCreateCourseDir:
          s.confirmOnCreateCourseDir ??
          DEFAULT_SETTINGS.confirmOnCreateCourseDir,
        toastSeconds: Number.isFinite(s.toastSeconds)
          ? s.toastSeconds
          : DEFAULT_SETTINGS.toastSeconds,
      });
    });
  });
}

/* ==========================
 * IDB: baseDir ハンドル
 * ========================== */

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function saveHandle(key, handle) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(key) {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteHandle(key) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ==========================
 * FSA: 権限 / ディレクトリ / 書き込み
 * ========================== */

async function ensureRWPermission(handle) {
  const q = await handle.queryPermission({ mode: "readwrite" });
  if (q === "granted") return true;
  const r = await handle.requestPermission({ mode: "readwrite" });
  return r === "granted";
}

async function getCurrentBaseDirOrNull() {
  try {
    const h = await loadHandle("baseDir");
    if (!h) return null;
    const ok = await ensureRWPermission(h);
    return ok ? h : null;
  } catch {
    return null;
  }
}

/** 未設定/権限なし/強制再選択時はピッカーを開く */
async function prepareBaseDir({ forceRechoose = false } = {}) {
  if (!forceRechoose) {
    const cur = await getCurrentBaseDirOrNull();
    if (cur) return cur;
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker();
  } catch (e) {
    const err = new Error("picker-cancelled");
    err.code = "PICKER_CANCELLED";
    throw err;
  }
  const ok = await ensureRWPermission(handle);
  if (!ok) {
    const err = new Error("permission-denied");
    err.code = "PERMISSION_DENIED";
    throw err;
  }
  try {
    await saveHandle("baseDir", handle);
  } catch {}
  return handle;
}

/** 科目ディレクトリ: 存在しない場合のみ設定に応じて confirm */
async function ensureCourseDirWithPolicy(baseDir, course, { confirmOnCreate }) {
  try {
    const exists = await baseDir.getDirectoryHandle(course, { create: false });
    return exists;
  } catch {}
  if (confirmOnCreate) {
    const ok = window.confirm(
      `科目ディレクトリを作成します:\n${course}\n\n作成してよろしいですか？`
    );
    if (!ok) {
      const err = new Error("course-dir-declined");
      err.code = "COURSE_DIR_DECLINED";
      throw err;
    }
  }
  return await baseDir.getDirectoryHandle(course, { create: true });
}

async function writeResponseToFile(parentDir, fileName, response) {
  const fileHandle = await parentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    if (response.body && typeof response.body.pipeTo === "function") {
      await response.body.pipeTo(writable);
    } else {
      const blob = await response.blob();
      await writable.write(blob);
      await writable.close();
    }
  } catch (e) {
    try {
      await writable.abort();
    } catch {}
    throw e;
  }
}

function showToast(text, seconds = 4) {
  const id = "echo-sort-toast";
  let box = document.getElementById(id);
  if (!box) {
    box = document.createElement("div");
    box.id = id;
    box.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      max-width: 420px; font: 14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
      color: #222; background: #fff; border: 1px solid #dedede; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.12); padding: 10px 12px;
    `;
    document.documentElement.appendChild(box);
  }
  box.textContent = text;
  box.style.display = "block";
  const ms = Math.max(1, seconds | 0) * 1000;
  setTimeout(() => {
    box.style.display = "none";
  }, ms);
}

/* ==========================
 * 保存処理本体
 * ========================== */

/** 名前の決定と総合デコード: <a download> > CD: filename* / filename > URL末尾 */
function decideBaseName(a, resp, url) {
  // <a download="..."> があれば最優先
  const fromAttr = a.getAttribute("download");
  if (fromAttr) {
    let v = fromAttr;
    if (/%[0-9A-Fa-f]{2}/.test(v)) v = safeDecodeURIComponent(v);
    return sanitize(v);
  }

  // Content-Disposition
  const cd = resp.headers.get("Content-Disposition");
  const fromCD = getFilenameFromContentDisposition(cd);
  if (fromCD) {
    return sanitize(fromCD);
  }

  // URL 末尾（%エンコード考慮）
  const lastRaw = url.pathname.split("/").pop() || "download";
  const last = /%[0-9A-Fa-f]{2}/.test(lastRaw)
    ? safeDecodeURIComponent(lastRaw)
    : lastRaw;

  return sanitize(last);
}

async function saveLinkOnce(a, { forceRechoose = false } = {}) {
  const absUrl = getAbsoluteHref(a);
  if (!absUrl) return { kind: "skip", reason: "no-abs-url" };

  const settings = await loadSettings();

  // fetch
  let resp;
  try {
    resp = await fetch(absUrl, { credentials: "include" });
  } catch (e) {
    const err = new Error("fetch-failed");
    err.code = "FETCH_FAILED";
    err.cause = e;
    throw err;
  }
  if (!resp.ok) {
    const err = new Error(`http-${resp.status}`);
    err.code = "HTTP_ERROR";
    err.status = resp.status;
    throw err;
  }

  // path
  const course = getCourseNameFromDOM();
  const url = new URL(absUrl);
  const fileName = decideBaseName(a, resp, url);

  // base + course dir
  const baseDir = await prepareBaseDir({ forceRechoose });
  const courseDir = await ensureCourseDirWithPolicy(baseDir, course, {
    confirmOnCreate: !!settings.confirmOnCreateCourseDir,
  });

  // write
  try {
    await writeResponseToFile(courseDir, fileName, resp);
  } catch (e) {
    const err = new Error("write-failed");
    err.code = "WRITE_FAILED";
    err.cause = e;
    throw err;
  }

  // toast
  showToast(
    `保存しました: ${course}/${fileName}`,
    Number(settings.toastSeconds) || 4
  );

  return { kind: "saved", path: `${course}/${fileName}` };
}

/* ==========================
 * 初期化バナー（未設定時）
 * ========================== */

function showSetupBanner() {
  if (document.getElementById("echo-sort-setup-banner")) return;
  const bar = document.createElement("div");
  bar.id = "echo-sort-setup-banner";
  bar.style.cssText = `
    position: fixed; z-index: 2147483647; right: 12px; bottom: 12px;
    background: #fff; color: #222; border: 1px solid #ddd; border-radius: 10px;
    padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.12); font: 14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
  `;
  bar.innerHTML = `
    <div style="margin-bottom:8px;"><strong>Echo sort:</strong> 保存先フォルダが未設定です。</div>
    <div style="display:flex; gap:8px; justify-content:flex-end;">
      <button id="echo-sort-pick" style="padding:6px 10px; border-radius:8px; border:1px solid #ccc; background:#f6f6f6; cursor:pointer;">保存先を選ぶ</button>
      <button id="echo-sort-close" style="padding:6px 10px; border-radius:8px; border:1px solid #eee; background:#fff; cursor:pointer;">閉じる</button>
    </div>
  `;
  document.documentElement.appendChild(bar);
  bar.querySelector("#echo-sort-pick").addEventListener("click", async () => {
    try {
      await prepareBaseDir({ forceRechoose: true });
      bar.remove();
    } catch {}
  });
  bar
    .querySelector("#echo-sort-close")
    .addEventListener("click", () => bar.remove());
}

(async () => {
  const cur = await getCurrentBaseDirOrNull();
  if (!cur) showSetupBanner();
})();

/* ==========================
 * クリック捕捉
 * ========================== */

document.addEventListener(
  "click",
  async (e) => {
    if (document.visibilityState === "hidden") return;

    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;

    if (!/manaba\.tsukuba\.ac\.jp$/.test(location.host)) return;

    const isAlt = e.altKey;
    if (!isAlt && !looksLikeFileLink(a)) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      await saveLinkOnce(a, { forceRechoose: isAlt });
      a.style.outline = "2px solid #4caf50";
      setTimeout(() => (a.style.outline = ""), 1100);
    } catch (err1) {
      if (
        err1 &&
        (err1.code === "COURSE_DIR_DECLINED" ||
          err1.code === "PICKER_CANCELLED")
      )
        return;

      if (
        err1 &&
        (err1.code === "WRITE_FAILED" || err1.code === "PERMISSION_DENIED")
      ) {
        try {
          await saveLinkOnce(a, { forceRechoose: true });
          a.style.outline = "2px solid #4caf50";
          setTimeout(() => (a.style.outline = ""), 1100);
          return;
        } catch (err2) {
          console.error(
            "Echo sort save error (retry):",
            err2.code || err2,
            err2
          );
        }
      } else {
        console.error("Echo sort save error:", err1.code || err1, err1);
      }

      try {
        a.style.outline = "2px solid #f44336";
        setTimeout(() => (a.style.outline = ""), 1400);
      } catch {}
      location.href = a.href;
    }
  },
  true
);

/* ==========================
 * オプションページとのメッセージ連携
 * ========================== */

// ガード：chrome.runtime が無い環境で落ちないように
const hasRuntime =
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  typeof chrome.runtime.onMessage === "function";

if (hasRuntime) {
  chrome.runtime.onMessage.addListener((msg) => {
    (async () => {
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "PICK_BASE_DIR") {
        try {
          await prepareBaseDir({ forceRechoose: true });
          const h = await getCurrentBaseDirOrNull();
          chrome.runtime.sendMessage({
            type: "BASE_DIR_PICKED",
            ok: true,
            name: h?.name || "(unknown)",
          });
        } catch (e) {
          chrome.runtime.sendMessage({
            type: "BASE_DIR_PICKED",
            ok: false,
            error: e?.code || String(e),
          });
        }
        return;
      }

      if (msg.type === "GET_BASE_DIR_STATUS") {
        const h = await getCurrentBaseDirOrNull();
        chrome.runtime.sendMessage({
          type: "BASE_DIR_STATUS",
          has: !!h,
          name: h?.name || "",
        });
        return;
      }

      if (msg.type === "CLEAR_BASE_DIR") {
        try {
          await deleteHandle("baseDir");
          chrome.runtime.sendMessage({ type: "BASE_DIR_CLEARED", ok: true });
        } catch (e) {
          chrome.runtime.sendMessage({
            type: "BASE_DIR_CLEARED",
            ok: false,
            error: String(e),
          });
        }
        return;
      }
    })();
  });
}
// const input = document.createElement("input");
// input.type = "checkbox";
// document.body.insertAdjacentElement("afterbegin", input);
// input.addEventListener('change', () => {
// b = input.checked;
// console.log(b);
// });
