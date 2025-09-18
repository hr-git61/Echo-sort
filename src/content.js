// == Echo sort (File System Access API版 / 科目ディレクトリ確認付き) ======
// クリックで manaba/<科目名>/<元ファイル名> に直接保存。
// - MAIN ワールドで動作（FSA/IndexedDB をページオリジンで利用）
// - 保存先未設定なら初期化バナーで案内 / Alt+クリックで再選択
// - ★ 科目ディレクトリ manaba/<科目名> が無ければ confirm で作成可否を確認
// =======================================================================

"use strict";

/* ==========================
 * 定数・ユーティリティ
 * ========================== */

const ROOT_DIR = "manaba";
const DB_NAME = "echo-sort-fsa";
const STORE = "handles";

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
  const exts = /\.(pdf|zip|docx?|pptx?|xlsx?|csv|png|jpe?g|gif|txt|md|ppt|xls)(\?|#|$)/i;
  if (exts.test(href)) return true;
  if (/download|attach|file/.test(href)) return true;
  return false;
}

function getFilenameFromContentDisposition(cd) {
  if (!cd) return null;
  const fnStar = cd.match(/filename\*\s*=\s*([^;]+)/i);
  if (fnStar) {
    let v = fnStar[1].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    const star = v.split("''");
    if (star.length === 2) {
      try { return decodeURIComponent(star[1]); } catch { }
    }
    return v;
  }
  const fn = cd.match(/filename\s*=\s*([^;]+)/i);
  if (fn) {
    let v = fn[1].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
  }
  return null;
}

/* ==========================
 * IndexedDB（フォルダハンドルの永続化）
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

/* ==========================
 * FSA: 権限 / ディレクトリ / 書き込み
 * ========================== */

async function ensureRWPermission(handle) {
  const q = await handle.queryPermission({ mode: "readwrite" });
  if (q === "granted") return true;
  const r = await handle.requestPermission({ mode: "readwrite" });
  return r === "granted";
}

/** manaba 直下と科目ディレクトリを用意。科目ディレクトリが無ければ confirm で作成可否を尋ねる。 */
async function ensureRootAndCourseDirWithConfirm(baseDir, course, { askConfirm = true } = {}) {
  // manaba 直下は静かに作成（存在しなければ）
  const root = await baseDir.getDirectoryHandle(ROOT_DIR, { create: true });

  // 既存チェック
  try {
    const courseDir = await root.getDirectoryHandle(course, { create: false });
    return courseDir; // 既存 → 確認不要
  } catch (e) {
    // NotFound → 新規作成の可否を確認
    if (askConfirm) {
      const ok = window.confirm(
        `科目ディレクトリを作成します:\n${ROOT_DIR}/${course}\n\n作成してよろしいですか？`
      );
      if (!ok) {
        const err = new Error("course-dir-declined");
        err.code = "COURSE_DIR_DECLINED";
        throw err;
      }
    }
    // 同意あり → 作成
    return await root.getDirectoryHandle(course, { create: true });
  }
}

async function writeBlobToFile(parentDir, fileName, response) {
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
    try { await writable.abort(); } catch { }
    throw e;
  }
}

/** 現在のベースディレクトリを取得（権限がなければ null） */
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

/** 保存先を準備：未設定/権限なし/強制再選択時はピッカーを開く */
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
  try { await saveHandle("baseDir", handle); } catch { }
  return handle;
}

/* ==========================
 * 保存処理本体
 * ========================== */

function decideBaseName(a, resp, url) {
  const fromAttr = a.getAttribute("download");
  if (fromAttr) return sanitize(fromAttr);
  const cd = resp.headers.get("Content-Disposition");
  const fromCD = getFilenameFromContentDisposition(cd);
  if (fromCD) return sanitize(fromCD);
  const last = url.pathname.split("/").pop();
  if (last) return sanitize(last);
  return "download";
}

async function saveLinkOnce(a, { forceRechoose = false } = {}) {
  const absUrl = getAbsoluteHref(a);
  if (!absUrl) return { kind: "skip", reason: "no-abs-url" };

  // 1) fetch
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

  // 2) path
  const course = getCourseNameFromDOM();
  const url = new URL(absUrl);
  const fileName = decideBaseName(a, resp, url);

  // 3) baseDir + courseDir (confirm if create)
  const baseDir = await prepareBaseDir({ forceRechoose });
  const courseDir = await ensureRootAndCourseDirWithConfirm(baseDir, course, { askConfirm: true });

  // 4) write
  try {
    await writeBlobToFile(courseDir, fileName, resp);
  } catch (e) {
    const err = new Error("write-failed");
    err.code = "WRITE_FAILED";
    err.cause = e;
    throw err;
  }
  return { kind: "saved", path: `${ROOT_DIR}/${course}/${fileName}` };
}

/* ==========================
 * 初期化バナー（保存先が未設定のとき表示）
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
    } catch (e) {
      // ユーザキャンセル等は無視
    }
  });
  bar.querySelector("#echo-sort-close").addEventListener("click", () => bar.remove());
}

(async () => {
  const cur = await getCurrentBaseDirOrNull();
  if (!cur) showSetupBanner();
})();

/* ==========================
 * クリック捕捉
 * ========================== */

document.addEventListener("click", async (e) => {
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
    // 科目ディレクトリ作成の拒否は静かに中断
    if (err1 && err1.code === "COURSE_DIR_DECLINED") return;

    // 書き込み/権限は一度だけ再選択してリトライ
    if (err1 && (err1.code === "WRITE_FAILED" || err1.code === "PERMISSION_DENIED")) {
      try {
        await saveLinkOnce(a, { forceRechoose: true });
        a.style.outline = "2px solid #4caf50";
        setTimeout(() => (a.style.outline = ""), 1100);
        return;
      } catch (err2) {
        console.error("Echo sort save error (retry):", err2.code || err2, err2);
      }
    } else {
      console.error("Echo sort save error:", err1.code || err1, err1);
    }

    // 最後にフォールバック遷移
    try {
      a.style.outline = "2px solid #f44336";
      setTimeout(() => (a.style.outline = ""), 1400);
    } catch { }
    location.href = a.href;
  }
}, true);
