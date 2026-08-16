/* ================================================================
   KEUANGANBOT - app.js (frontend, dihost terpisah dari backend)
   ================================================================
   WAJIB DIISI sebelum deploy: URL Web App backend (Apps Script),
   yang berakhiran /exec. Dapatkan dari Deploy > Manage deployments
   di project Apps Script kamu (setelah pasang api-tambahan.gs.js).
================================================================ */
const BACKEND_URL = "https://script.google.com/macros/s/AKfycbyL6pcyfh3Us13p-eT0vNI2fz-0M4QE5bXsQUzeLWCt86SeZPzop75YuQGyDOjARUEKQw/exec"; // contoh: https://script.google.com/macros/s/XXXXXXXX/exec

/* ---------------------------------------------------------------
   STATE & HELPERS DASAR
--------------------------------------------------------------- */
const S = {
  token: localStorage.getItem("kb_token") || "",
  username: "",
  chatId: "",
  email: "",
  isAdmin: false,
  adminToken: localStorage.getItem("kb_admin_token") || "",
  currentPage: "dashboard",
  txCache: [],       // cache transaksi utk filter/laporan sisi klien
  categories: new Set(),
  accounts: new Set(),
};

function fmtRp(n) {
  n = Number(n) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function showLoading(msg) {
  $("#loadingText").textContent = msg || "Memuat...";
  $("#loadingOverlay").classList.remove("hidden");
}
function hideLoading() {
  $("#loadingOverlay").classList.add("hidden");
}

function toast(msg, type) {
  const box = document.createElement("div");
  const colors = { error: "bg-tertiary-container text-on-tertiary-container", success: "bg-secondary-container text-on-secondary-container" };
  box.className = "border-2 border-ink-black neo-shadow rounded-xl px-4 py-3 font-label-md text-label-md max-w-xs " +
    (colors[type] || "bg-paper-white");
  box.textContent = msg;
  $("#toastContainer").appendChild(box);
  setTimeout(() => box.remove(), 4000);
}

function notAvailable() {
  toast("Fitur ini belum tersedia di web. Gunakan bot Telegram untuk sekarang.", "error");
}

/* ---------------------------------------------------------------
   API CLIENT (fetch, bukan google.script.run - karena frontend
   & backend sekarang di domain berbeda)
--------------------------------------------------------------- */
function api(fn, args) {
  if (!BACKEND_URL || BACKEND_URL.indexOf("PASTE_URL") === 0) {
    toast("BACKEND_URL belum diisi di app.js.", "error");
    return Promise.resolve({ ok: false, message: "BACKEND_URL belum dikonfigurasi." });
  }
  const url = BACKEND_URL + "?api=1&fn=" + encodeURIComponent(fn) + "&a=" + encodeURIComponent(JSON.stringify(args || []));
  return fetch(url)
    .then(r => r.json())
    .then(res => {
      if (res && res.ok === false && res.message && res.message.indexOf("Sesi berakhir") !== -1) {
        doLogout(true);
      }
      return res;
    })
    .catch(err => {
      toast("Gagal menghubungi server: " + err.message, "error");
      return { ok: false, message: err.message };
    });
}

// Sama seperti api(), tapi lewat POST dgn Content-Type: text/plain
// (bukan application/json) supaya tetap "simple request" & tidak kena
// preflight OPTIONS (Apps Script tidak mendukungnya). Dipakai KHUSUS
// untuk payload besar yang tidak muat di query string GET, misalnya
// upload foto struk base64 (bisa ratusan KB - beberapa MB).
function apiUpload(fn, args) {
  if (!BACKEND_URL || BACKEND_URL.indexOf("PASTE_URL") === 0) {
    toast("BACKEND_URL belum diisi di app.js.", "error");
    return Promise.resolve({ ok: false, message: "BACKEND_URL belum dikonfigurasi." });
  }
  const body = JSON.stringify({ api: "1", fn: fn, a: JSON.stringify(args || []) });
  return fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: body,
  })
    .then(r => r.json())
    .then(res => {
      if (res && res.ok === false && res.message && res.message.indexOf("Sesi berakhir") !== -1) {
        doLogout(true);
      }
      return res;
    })
    .catch(err => {
      toast("Gagal menghubungi server: " + err.message, "error");
      return { ok: false, message: err.message };
    });
}

/* ---------------------------------------------------------------
   NAVIGASI / ROUTER
--------------------------------------------------------------- */
const NAV_ITEMS = [
  { page: "dashboard", label: "Dashboard", icon: "dashboard" },
  { page: "transactions", label: "Transaksi", icon: "receipt_long" },
  { page: "addTransaction", label: "Tambah Transaksi", icon: "add_box" },
  { page: "accounts", label: "Rekening & Saldo", icon: "account_balance" },
  { page: "budget", label: "Budget", icon: "savings" },
  { page: "recurring", label: "Transaksi Berulang", icon: "autorenew" },
  { page: "reports", label: "Laporan & Statistik", icon: "analytics" },
  { page: "settings", label: "Pengaturan", icon: "settings" },
];

function renderNavMenu() {
  const ul = $("#navMenu");
  if (!ul) return;
  let items = NAV_ITEMS.slice();
  if (S.isAdmin) items.push({ page: "admin", label: "Dashboard Admin", icon: "shield_person" });
  ul.innerHTML = items.map(it =>
    `<li><button data-page="${it.page}" class="w-full flex items-center gap-3 p-3 rounded-xl font-label-md text-label-md hover:bg-surface-container-low border-2 border-transparent nav-item" data-nav="${it.page}">
      <span class="material-symbols-outlined">${it.icon}</span><span>${it.label}</span>
    </button></li>`
  ).join("");
  ul.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => goToPage(btn.getAttribute("data-nav")));
  });
}

function goToPage(page) {
  if (!S.token && page !== "login" && page !== "linkTelegram" && page !== "admin") {
    page = "login";
  }
  $all(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById("page" + page.charAt(0).toUpperCase() + page.slice(1));
  if (el) el.classList.add("active");
  S.currentPage = page;

  $all("[data-page]").forEach(btn => {
    btn.classList.toggle("bg-primary", btn.getAttribute("data-page") === page);
    btn.classList.toggle("text-on-primary", btn.getAttribute("data-page") === page);
  });
  $all(".nav-item").forEach(btn => {
    btn.classList.toggle("bg-primary", btn.getAttribute("data-nav") === page);
    btn.classList.toggle("text-on-primary", btn.getAttribute("data-nav") === page);
  });

  closeSidebar();
  loadPageData(page);
}

function loadPageData(page) {
  if (page === "dashboard") return renderDashboard();
  if (page === "transactions") return renderTransactionsPage();
  if (page === "addTransaction") return renderAddTransactionPage();
  if (page === "accounts") return renderAccountsPage();
  if (page === "budget") return renderBudgetPage();
  if (page === "recurring") return renderRecurringPage();
  if (page === "reports") return renderReportsPage("bulan ini");
  if (page === "settings") return renderSettingsPage();
  if (page === "admin") return renderAdminPage();
}

function openSidebar() { $("#sidebar").classList.add("open"); $("#sidebarOverlay").classList.add("open"); }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#sidebarOverlay").classList.remove("open"); }

/* ---------------------------------------------------------------
   AUTH: LOGIN VIA KODE OTP DARI BOT TELEGRAM
   (Halaman "pageLinkTelegram" dipakai ulang sbg form masukkan kode,
   bukan menampilkan kode - karena kode DIBUAT oleh bot, bukan web)
--------------------------------------------------------------- */
/* ---------------------------------------------------------------
   TAB ID: dipakai supaya server tahu 1 percobaan OTP datang dari
   tab browser yang mana (sessionStorage = per-tab, bukan per-browser
   seperti localStorage). Dipakai untuk mencegah "bolak-balik OTP":
   begitu 1 tab sudah mulai/menyelesaikan satu proses verifikasi,
   tab itu dikunci dan harus minta kode baru dari bot kalau mau coba lagi.
--------------------------------------------------------------- */
function getTabId() {
  let id = sessionStorage.getItem("kb_tab_id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : ("tab_" + Date.now() + "_" + Math.random().toString(36).slice(2)));
    sessionStorage.setItem("kb_tab_id", id);
  }
  return id;
}

let otpPollTimer = null;
let otpPollDeadline = 0;

function setupLoginPage() {
  $("#btnLoginTelegram").addEventListener("click", () => goToLinkTelegramForm());
  $("#showLinkTelegram").addEventListener("click", () => goToLinkTelegramForm());
  $("#backToLogin").addEventListener("click", () => { stopOtpPolling(); goToPage("login"); });

  $("#btnVerifyOtp").addEventListener("click", doVerifyCode);
  $("#otpCode").addEventListener("keydown", (e) => { if (e.key === "Enter") doVerifyCode(); });
  $("#btnOpenTelegram").addEventListener("click", () => window.open("https://t.me/", "_blank"));
  $("#btnOpenTelegram2").addEventListener("click", () => window.open("https://t.me/", "_blank"));
  $("#btnCancelWaiting").addEventListener("click", () => { stopOtpPolling(); showOtpStep("input"); });
  $("#btnRetryOtp").addEventListener("click", () => {
    sessionStorage.removeItem("kb_otp_locked");
    $("#otpCode").value = "";
    showOtpStep("input");
  });
}

function showOtpStep(step) {
  $("#otpStepInput").classList.toggle("hidden", step !== "input");
  $("#otpStepWaiting").classList.toggle("hidden", step !== "waiting");
  $("#otpStepFailed").classList.toggle("hidden", step !== "failed");
}

function goToLinkTelegramForm() {
  // Satu tab yang sudah pernah menuntaskan 1 percobaan OTP (berhasil,
  // ditolak, atau kadaluarsa) tidak otomatis dibuka lagi ke form input -
  // cegah user bolak-balik coba kode yang sama di tab yang sama.
  if (sessionStorage.getItem("kb_otp_locked") === "1") {
    goToPage("linkTelegram");
    showOtpStep("failed");
    $("#otpFailedTitle").textContent = "Sesi OTP Tab Ini Sudah Dipakai";
    $("#otpFailedText").textContent = "Untuk keamanan, satu tab browser hanya bisa mencoba 1 sesi verifikasi. Buka tab baru, atau tekan tombol di bawah untuk mencoba lagi di tab ini dengan kode baru dari bot.";
    return;
  }
  showOtpStep("input");
  goToPage("linkTelegram");

  const urlCode = new URLSearchParams(location.search).get("code");
  if (urlCode) $("#otpCode").value = urlCode.toUpperCase();
}

function doVerifyCode() {
  const codeEl = $("#otpCode");
  const code = (codeEl.value || "").trim().toUpperCase();
  if (code.length !== 6) { toast("Kode harus 6 karakter.", "error"); return; }

  $("#btnVerifyOtp").setAttribute("disabled", "true");
  showLoading("Memverifikasi kode...");
  api("webVerifikasi_", [code, getTabId()]).then(res => {
    hideLoading();
    $("#btnVerifyOtp").removeAttribute("disabled");

    if (!res.ok) { toast(res.message || "Kode salah.", "error"); return; }

    // Kode benar -> BUKAN langsung login. Tunggu user menekan Izinkan/Tolak
    // di Telegram dulu (cegah penyalahgunaan kalau kode ketebak/bocor).
    if (res.pending) {
      history.replaceState(null, "", location.pathname);
      sessionStorage.setItem("kb_otp_locked", "1"); // tab ini sudah "dipakai" utk 1 percobaan
      showOtpStep("waiting");
      startOtpPolling(res.pendingId);
    }
  });
}

function startOtpPolling(pendingId) {
  stopOtpPolling();
  otpPollDeadline = Date.now() + 3 * 60 * 1000; // sinkron dgn WEB_PENDING_MENIT di backend
  otpPollTimer = setInterval(() => pollOtpStatus(pendingId), 2000);
  pollOtpStatus(pendingId);
}

function stopOtpPolling() {
  if (otpPollTimer) { clearInterval(otpPollTimer); otpPollTimer = null; }
}

function pollOtpStatus(pendingId) {
  if (Date.now() > otpPollDeadline) {
    stopOtpPolling();
    showOtpFailed("Waktu Konfirmasi Habis", "Kamu tidak menekan Izinkan dalam 3 menit. Ketik `web` lagi di bot untuk kode baru.");
    return;
  }
  api("webCekKonfirmasi_", [pendingId]).then(res => {
    if (!res.ok) {
      stopOtpPolling();
      showOtpFailed("Sesi Verifikasi Bermasalah", res.message || "Sesi verifikasi tidak valid lagi. Minta kode baru dari bot.");
      return;
    }
    if (res.status === "pending") return; // masih menunggu, terus polling

    stopOtpPolling();
    if (res.status === "approved") {
      S.token = res.token;
      S.username = res.username || "";
      S.chatId = res.chatId || "";
      S.isAdmin = !!res.isAdmin;
      localStorage.setItem("kb_token", S.token);
      afterLogin();
    } else if (res.status === "rejected") {
      showOtpFailed("Login Ditolak", "Permintaan login ini ditolak lewat Telegram. Kalau ini kamu, ulangi dari bot dan pastikan menekan Izinkan.");
    } else if (res.status === "expired") {
      showOtpFailed("Waktu Konfirmasi Habis", res.message || "Ketik `web` lagi di bot untuk kode baru.");
    }
  });
}

function showOtpFailed(title, text) {
  showOtpStep("failed");
  $("#otpFailedTitle").textContent = title;
  $("#otpFailedText").textContent = text;
}

function afterLogin() {
  sessionStorage.removeItem("kb_otp_locked"); // sudah login, kunci tab tidak relevan lagi
  renderNavMenu();
  $("#userPlan").textContent = S.username ? ("Halo, " + S.username) : "Free User";
  goToPage("dashboard");
}

function doLogout(silent) {
  if (S.token) api("webLogout_", [S.token]);
  S.token = "";
  S.isAdmin = false;
  localStorage.removeItem("kb_token");
  localStorage.removeItem("kb_admin_token");
  sessionStorage.removeItem("kb_otp_locked");
  if (!silent) toast("Berhasil keluar.", "success");
  goToPage("login");
}

/* ---------------------------------------------------------------
   DASHBOARD
--------------------------------------------------------------- */
function renderDashboard() {
  showLoading("Memuat dashboard...");
  api("webGetRingkasan_", [S.token]).then(res => {
    hideLoading();
    if (!res.ok) { toast(res.message || "Gagal memuat data.", "error"); return; }
    S.email = res.email || "";

    $("#totalSaldo").textContent = fmtRp(res.total);
    $("#totalPemasukan").textContent = "+ " + fmtRp(res.masukBulan);
    $("#totalPengeluaran").textContent = "- " + fmtRp(res.keluarBulan);

    // Rekening -> set kategori/akun cache dasar
    (res.saldo || []).forEach(s => S.accounts.add(s.nama));

    // Transaksi terakhir
    const list = $("#transactionsList");
    if (!res.transaksi || !res.transaksi.length) {
      list.innerHTML = '<div class="flex items-center justify-center py-12 text-on-surface-variant"><p>Belum ada transaksi. Tambahkan transaksi pertama Anda!</p></div>';
    } else {
      list.innerHTML = res.transaksi.slice(0, 8).map(t => transactionRowHtml(t)).join("");
    }

    // Chart sederhana: pengeluaran per kategori (dari 10 transaksi terakhir yg tampil di ringkasan)
    drawExpenseChart("expenseChart", "chartEmpty", res.transaksi || []);

    // Budget mini widget: pakai budget pertama (jika ada)
    api("webGetBudget_", [S.token]).then(b => {
      if (b.ok && b.budget && b.budget.length) {
        const bt = b.budget[0];
        const persen = Math.min(bt.persen, 100);
        $("#budgetProgress").style.width = persen + "%";
        $("#budgetText").textContent = `${persen}% - ${bt.kategori}: ${fmtRp(bt.dipakai)} / ${fmtRp(bt.limit)}`;
      } else {
        $("#budgetText").textContent = "0% - Belum ada budget";
      }
    });
  });

  $("#btnAddTransaction").onclick = () => goToPage("addTransaction");
  $("#btnUploadReceipt").onclick = () => toast("Upload struk foto hanya lewat chat Telegram bot untuk saat ini.");
  $("#btnViewAllTransactions").onclick = () => goToPage("transactions");
}

function transactionRowHtml(t) {
  const isMasuk = t.tipe === "Masuk";
  return `<div class="flex items-center justify-between py-3 border-b-2 border-ink-black last:border-b-0 transaction-row px-2">
    <div class="min-w-0">
      <p class="font-label-md text-label-md truncate">${escapeHtml(t.kategori)}</p>
      <p class="text-xs text-on-surface-variant">${escapeHtml(t.waktu)} • ${escapeHtml(t.rekening)}</p>
    </div>
    <p class="font-currency-display text-sm font-bold ${isMasuk ? "text-secondary" : "text-tertiary"} shrink-0 ml-2">
      ${isMasuk ? "+" : "-"} ${fmtRp(t.jumlah)}
    </p>
  </div>`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function drawExpenseChart(canvasId, emptyId, transaksi) {
  const canvas = document.getElementById(canvasId);
  const emptyEl = document.getElementById(emptyId);
  if (!canvas) return;
  const totals = {};
  (transaksi || []).forEach(t => {
    if (t.tipe !== "Masuk") totals[t.kategori] = (totals[t.kategori] || 0) + t.jumlah;
  });
  const entries = Object.entries(totals);
  if (!entries.length) { emptyEl.style.display = "flex"; canvas.style.display = "none"; return; }
  emptyEl.style.display = "none";
  canvas.style.display = "block";
  drawPie(canvas, entries);
}

const CHART_COLORS = ["#004ac6", "#ab0b1c", "#006e2f", "#f1c40f", "#8e44ad", "#16a085", "#e67e22", "#2c3e50"];

function drawPie(canvas, entries) {
  const parent = canvas.parentElement;
  const size = Math.min(parent.clientWidth, parent.clientHeight) || 240;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  let start = -Math.PI / 2;
  const cx = size / 2, cy = size / 2, r = size / 2 - 10;
  entries.forEach(([, v], i) => {
    const angle = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = "#0F172A";
    ctx.lineWidth = 2;
    ctx.stroke();
    start += angle;
  });
}

/* ---------------------------------------------------------------
   TRANSAKSI (list, filter, hapus)
--------------------------------------------------------------- */
let txPage = 0;
const TX_PAGE_SIZE = 15;

function renderTransactionsPage() {
  showLoading("Memuat transaksi...");
  api("webGetTransaksi_", [S.token, 300]).then(res => {
    hideLoading();
    if (!res.ok) { toast(res.message || "Gagal memuat transaksi.", "error"); return; }
    S.txCache = res.transaksi || [];
    S.txCache.forEach(t => { S.categories.add(t.kategori); S.accounts.add(t.rekening); });
    populateSelect("#filterCategory", S.categories, true);
    populateSelect("#filterAccount", S.accounts, true);
    txPage = 0;
    renderTxTable();
  });

  $("#filterType").onchange = () => { txPage = 0; renderTxTable(); };
  $("#filterCategory").onchange = () => { txPage = 0; renderTxTable(); };
  $("#filterAccount").onchange = () => { txPage = 0; renderTxTable(); };
  $("#btnAddTransaction2").onclick = () => goToPage("addTransaction");
  $("#btnPrevPage").onclick = () => { if (txPage > 0) { txPage--; renderTxTable(); } };
  $("#btnNextPage").onclick = () => { txPage++; renderTxTable(); };
}

function getFilteredTx() {
  const type = $("#filterType").value;
  const cat = $("#filterCategory").value;
  const acc = $("#filterAccount").value;
  return S.txCache.filter(t =>
    (!type || t.tipe === type) &&
    (!cat || t.kategori === cat) &&
    (!acc || t.rekening === acc)
  );
}

function renderTxTable() {
  const filtered = getFilteredTx();
  const start = txPage * TX_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + TX_PAGE_SIZE);
  const tbody = $("#transactionsTableBody");
  tbody.innerHTML = pageItems.map(t => `
    <tr class="transaction-row border-b-2 border-ink-black">
      <td class="p-3">${escapeHtml(t.waktu)}</td>
      <td class="p-3">${escapeHtml(t.kategori)}</td>
      <td class="p-3 txt">${escapeHtml(t.pesan || "-")}</td>
      <td class="p-3 text-right font-bold ${t.tipe === "Masuk" ? "text-secondary" : "text-tertiary"}">${t.tipe === "Masuk" ? "+" : "-"} ${fmtRp(t.jumlah)}</td>
      <td class="p-3">${escapeHtml(t.rekening)}</td>
      <td class="p-3 text-center">
        <button class="text-tertiary underline text-sm" data-del="${t.row}">Hapus</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="p-6 text-center text-on-surface-variant">Tidak ada transaksi.</td></tr>`;

  tbody.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!confirm("Hapus transaksi ini? Saldo akan dikembalikan.")) return;
      showLoading("Menghapus...");
      api("webHapusTransaksi_", [S.token, Number(btn.getAttribute("data-del"))]).then(res => {
        hideLoading();
        toast(res.message || (res.ok ? "Terhapus." : "Gagal."), res.ok ? "success" : "error");
        if (res.ok) renderTransactionsPage();
      });
    });
  });

  $("#paginationInfo").textContent = `Menampilkan ${pageItems.length ? start + 1 : 0}-${start + pageItems.length} dari ${filtered.length} transaksi`;
  $("#btnPrevPage").disabled = txPage === 0;
  $("#btnNextPage").disabled = start + TX_PAGE_SIZE >= filtered.length;
}

function populateSelect(sel, values, withAllOption) {
  const el = $(sel);
  if (!el) return;
  const current = el.value;
  const opts = Array.from(values).sort();
  el.innerHTML = (withAllOption ? '<option value="">Semua</option>' : '<option value="">Pilih...</option>') +
    opts.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if (opts.includes(current)) el.value = current;
}

/* ---------------------------------------------------------------
   TAMBAH TRANSAKSI (manual + AI) - keduanya lewat webCatatTransaksi_
   karena backend memproses lewat AI classifier yang sama.
--------------------------------------------------------------- */
function renderAddTransactionPage() {
  populateSelect("#categorySelect", S.categories, false);
  populateSelect("#accountSelect", S.accounts, false);
  $("#dateInput").value = new Date().toISOString().slice(0, 10);

  $("#tabManual").onclick = () => switchAddMode("manual");
  $("#tabAI").onclick = () => switchAddMode("ai");
  $("#tabStruk").onclick = () => switchAddMode("struk");
  $("#btnBackFromAdd").onclick = () => goToPage("dashboard");
  $("#btnCancelTransaction").onclick = () => goToPage("dashboard");
  $("#btnTypeExpense").onclick = () => setTxType("Keluar");
  $("#btnTypeIncome").onclick = () => setTxType("Masuk");
  setTxType($("#transactionType").value || "Keluar");

  $("#transactionForm").onsubmit = (e) => {
    e.preventDefault();
    const type = $("#transactionType").value;
    const cat = $("#categorySelect").value;
    const amount = $("#amountInput").value;
    const acc = $("#accountSelect").value;
    const note = $("#noteInput").value;
    if (!cat || !amount || !acc) { toast("Lengkapi kategori, jumlah, dan rekening.", "error"); return; }
    const pesan = `${cat} ${amount} ${type === "Masuk" ? "masuk" : "keluar"} ${acc}${note ? " - " + note : ""}`;
    submitTransaction(pesan);
  };

  $("#btnProcessAI").onclick = () => {
    const text = $("#aiInput").value.trim();
    if (!text) { toast("Ceritakan transaksinya dulu.", "error"); return; }
    submitTransaction(text);
  };
  $("#btnClearAI").onclick = () => { $("#aiInput").value = ""; $("#aiPreview").classList.add("hidden"); };

  setupStrukTab();
}

function switchAddMode(mode) {
  [["#tabManual", "manual"], ["#tabAI", "ai"], ["#tabStruk", "struk"]].forEach(([sel, m]) => {
    $(sel).classList.toggle("active", mode === m);
    $(sel).classList.toggle("bg-primary", mode === m);
    $(sel).classList.toggle("text-on-primary", mode === m);
  });
  $("#formManual").classList.toggle("hidden", mode !== "manual");
  $("#formAI").classList.toggle("hidden", mode !== "ai");
  $("#formStruk").classList.toggle("hidden", mode !== "struk");
}

/* ---------------------------------------------------------------
   FOTO STRUK (upload + baca via AI Vision HCNSec, langsung tersimpan
   jadi transaksi - mirip fitur kirim foto ke bot Telegram)
--------------------------------------------------------------- */
let strukBase64 = "";   // tanpa prefix "data:...;base64,"
let strukMime = "";

function setupStrukTab() {
  const fileInput = $("#strukFileInput");
  if (!fileInput) return;

  fileInput.value = "";
  strukBase64 = ""; strukMime = "";
  $("#strukPreviewWrap").classList.add("hidden");
  $("#strukResult").classList.add("hidden");
  $("#strukError").classList.add("hidden");
  $("#btnProcessStruk").disabled = true;

  fileInput.onchange = () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("File harus berupa gambar.", "error"); return; }
    if (file.size > 8 * 1024 * 1024) { toast("Ukuran foto maksimal 8MB.", "error"); return; }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // "data:image/png;base64,AAAA..."
      const comma = dataUrl.indexOf(",");
      strukBase64 = dataUrl.slice(comma + 1);
      strukMime = file.type || "image/jpeg";
      $("#strukPreviewImg").src = dataUrl;
      $("#strukPreviewWrap").classList.remove("hidden");
      $("#btnProcessStruk").disabled = false;
      $("#strukResult").classList.add("hidden");
      $("#strukError").classList.add("hidden");
    };
    reader.onerror = () => toast("Gagal membaca file gambar.", "error");
    reader.readAsDataURL(file);
  };

  $("#btnProcessStruk").onclick = () => {
    if (!strukBase64) { toast("Pilih foto struk dulu.", "error"); return; }
    const caption = $("#strukCaptionInput").value.trim();
    const btn = $("#btnProcessStruk");
    btn.disabled = true;
    showLoading("Membaca struk dengan AI Vision...");
    apiUpload("webUploadStruk_", [S.token, strukBase64, strukMime, caption]).then(res => {
      hideLoading();
      btn.disabled = false;
      if (!res.ok) {
        $("#strukError").classList.remove("hidden");
        $("#strukErrorText").textContent = res.message || "Gagal membaca foto struk.";
        $("#strukResult").classList.add("hidden");
        toast(res.message || "Gagal membaca foto struk.", "error");
        return;
      }
      $("#strukError").classList.add("hidden");
      $("#strukResult").classList.remove("hidden");
      $("#strukResultText").textContent = res.message || "Struk tersimpan.";
      toast("Struk tersimpan sebagai transaksi.", "success");
      if (res.data) { S.categories.add(res.data.kategori); S.accounts.add(res.data.rekening); }
    });
  };

  $("#btnClearStruk").onclick = () => {
    fileInput.value = "";
    strukBase64 = ""; strukMime = "";
    $("#strukCaptionInput").value = "";
    $("#strukPreviewWrap").classList.add("hidden");
    $("#strukResult").classList.add("hidden");
    $("#strukError").classList.add("hidden");
    $("#btnProcessStruk").disabled = true;
  };
}

function setTxType(type) {
  $("#transactionType").value = type;
  $("#btnTypeExpense").classList.toggle("ring-4", type === "Keluar");
  $("#btnTypeIncome").classList.toggle("ring-4", type === "Masuk");
}

function submitTransaction(pesan) {
  showLoading("Menyimpan transaksi...");
  api("webCatatTransaksi_", [S.token, pesan]).then(res => {
    hideLoading();
    if (!res.ok) {
      $("#aiError").classList.remove("hidden");
      $("#aiErrorText").textContent = res.message || "Gagal mencatat transaksi.";
      toast(res.message || "Gagal mencatat transaksi.", "error");
      return;
    }
    toast("Transaksi tersimpan.", "success");
    $("#transactionForm").reset();
    $("#aiInput").value = "";
    $("#aiError").classList.add("hidden");
    goToPage("dashboard");
  });
}

/* ---------------------------------------------------------------
   REKENING (read-only - backend belum punya CRUD rekening via web)
--------------------------------------------------------------- */
function renderAccountsPage() {
  showLoading("Memuat rekening...");
  api("webGetRingkasan_", [S.token]).then(res => {
    hideLoading();
    if (!res.ok) { toast(res.message || "Gagal memuat.", "error"); return; }
    const grid = $("#accountsGrid");
    grid.innerHTML = (res.saldo || []).map(a => `
      <div class="bg-paper-white border-2 border-ink-black neo-shadow rounded-xl p-6">
        <div class="flex items-center gap-2 mb-2">
          <span class="material-symbols-outlined">account_balance_wallet</span>
          <h4 class="font-label-md text-label-md">${escapeHtml(a.nama)}</h4>
        </div>
        <p class="font-currency-display text-currency-display">${fmtRp(a.saldo)}</p>
      </div>
    `).join("") || '<p class="text-on-surface-variant col-span-full">Belum ada rekening tercatat.</p>';
  });
  $("#btnAddAccount").onclick = () => toast("Tambah rekening baru: ketik pesan transaksi dengan nama rekening baru di chat Telegram bot, rekening otomatis dibuat.", "success");
}

/* ---------------------------------------------------------------
   BUDGET
--------------------------------------------------------------- */
function renderBudgetPage() {
  loadBudgetGrid();
  populateSelect("#budgetCategorySelect", S.categories, false);

  $("#btnAddBudget").onclick = () => { $("#budgetForm").reset(); $("#budgetModal").classList.add("active"); };
  $("#btnCancelBudget").onclick = () => $("#budgetModal").classList.remove("active");
  $("#budgetForm").onsubmit = (e) => {
    e.preventDefault();
    const kat = $("#budgetCategorySelect").value;
    const limit = $("#budgetLimitInput").value;
    if (!kat || !limit) { toast("Lengkapi kategori dan limit.", "error"); return; }
    showLoading("Menyimpan budget...");
    api("webBudgetSet_", [S.token, kat, limit]).then(res => {
      hideLoading();
      toast(res.message || (res.ok ? "Tersimpan." : "Gagal."), res.ok ? "success" : "error");
      if (res.ok) { $("#budgetModal").classList.remove("active"); loadBudgetGrid(); }
    });
  };
}

function loadBudgetGrid() {
  showLoading("Memuat budget...");
  api("webGetBudget_", [S.token]).then(res => {
    hideLoading();
    if (!res.ok) { toast(res.message || "Gagal memuat budget.", "error"); return; }
    const grid = $("#budgetGrid");
    grid.innerHTML = (res.budget || []).map(b => {
      const persen = Math.min(b.persen, 100);
      const barColor = persen >= 100 ? "bg-tertiary" : persen >= 80 ? "bg-canary-yellow" : "bg-secondary";
      return `<div class="bg-paper-white border-2 border-ink-black neo-shadow rounded-xl p-6">
        <div class="flex justify-between items-center mb-2">
          <h4 class="font-label-md text-label-md">${escapeHtml(b.kategori)}</h4>
          <button class="text-tertiary underline text-xs" data-off="${escapeHtml(b.kategori)}">Hapus</button>
        </div>
        <div class="w-full bg-surface-variant h-4 border-2 border-ink-black rounded-full overflow-hidden mb-2">
          <div class="${barColor} h-full" style="width:${persen}%"></div>
        </div>
        <p class="text-sm text-on-surface-variant">${fmtRp(b.dipakai)} / ${fmtRp(b.limit)} (${b.persen}%)</p>
      </div>`;
    }).join("") || '<p class="text-on-surface-variant col-span-full">Belum ada budget. Tambahkan dulu.</p>';

    grid.querySelectorAll("[data-off]").forEach(btn => {
      btn.addEventListener("click", () => {
        showLoading("Menghapus budget...");
        api("webBudgetOff_", [S.token, btn.getAttribute("data-off")]).then(r => {
          hideLoading();
          toast(r.message || (r.ok ? "Terhapus." : "Gagal."), r.ok ? "success" : "error");
          if (r.ok) loadBudgetGrid();
        });
      });
    });
  });
}

/* ---------------------------------------------------------------
   TRANSAKSI BERULANG
--------------------------------------------------------------- */
function renderRecurringPage() {
  loadRecurringTable();
  populateSelect("#recurringCategorySelect", S.categories, false);
  populateSelect("#recurringAccountSelect", S.accounts, false);

  $("#btnAddRecurring").onclick = () => { $("#recurringForm").reset(); $("#recurringModal").classList.add("active"); };
  $("#btnCancelRecurring").onclick = () => $("#recurringModal").classList.remove("active");
  $("#recurringBtnTypeExpense").onclick = () => $("#recurringTypeInput").value = "Keluar";
  $("#recurringBtnTypeIncome").onclick = () => $("#recurringTypeInput").value = "Masuk";

  $("#recurringForm").onsubmit = (e) => {
    e.preventDefault();
    const desk = $("#recurringDescInput").value;
    const jumlah = $("#recurringAmountInput").value;
    const rek = $("#recurringAccountSelect").value;
    const tipe = $("#recurringTypeInput").value;
    const hari = $("#recurringDayInput").value;
    if (!desk || !jumlah || !rek || !hari) { toast("Lengkapi semua field wajib.", "error"); return; }
    showLoading("Menyimpan...");
    api("webRecurringSet_", [S.token, desk, jumlah, rek, tipe, hari]).then(res => {
      hideLoading();
      toast(res.message || (res.ok ? "Tersimpan." : "Gagal."), res.ok ? "success" : "error");
      if (res.ok) { $("#recurringModal").classList.remove("active"); loadRecurringTable(); }
    });
  };
}

function loadRecurringTable() {
  showLoading("Memuat transaksi berulang...");
  api("webGetRecurring_", [S.token]).then(res => {
    hideLoading();
    if (!res.ok) { toast(res.message || "Gagal memuat.", "error"); return; }
    const tbody = $("#recurringTableBody");
    tbody.innerHTML = (res.recurring || []).map(r => `
      <tr class="border-b-2 border-ink-black">
        <td class="p-3">${escapeHtml(r.deskripsi)}</td>
        <td class="p-3">-</td>
        <td class="p-3 text-right">${fmtRp(r.jumlah)}</td>
        <td class="p-3">${escapeHtml(r.tipe)}</td>
        <td class="p-3">${escapeHtml(r.rekening)}</td>
        <td class="p-3">${escapeHtml(String(r.tanggal || "-"))}</td>
        <td class="p-3 text-center">${r.aktif ? "🟢 Aktif" : "⚪ Nonaktif"}</td>
        <td class="p-3 text-center"><button class="text-tertiary underline text-sm" data-off="${escapeHtml(r.deskripsi)}">Nonaktifkan</button></td>
      </tr>
    `).join("") || `<tr><td colspan="8" class="p-6 text-center text-on-surface-variant">Belum ada transaksi berulang.</td></tr>`;

    tbody.querySelectorAll("[data-off]").forEach(btn => {
      btn.addEventListener("click", () => {
        showLoading("Menonaktifkan...");
        api("webRecurringOff_", [S.token, btn.getAttribute("data-off")]).then(r => {
          hideLoading();
          toast(r.message || (r.ok ? "Nonaktif." : "Gagal."), r.ok ? "success" : "error");
          if (r.ok) loadRecurringTable();
        });
      });
    });
  });
}

/* ---------------------------------------------------------------
   LAPORAN
--------------------------------------------------------------- */
function renderReportsPage(periodeLabel) {
  $all("#reportPeriodTabs .tab-btn").forEach(btn => {
    btn.onclick = () => {
      $all("#reportPeriodTabs .tab-btn").forEach(b => b.classList.remove("active", "bg-primary", "text-on-primary"));
      btn.classList.add("active", "bg-primary", "text-on-primary");
      const map = { month: "bulan ini", last_month: "bulan lalu", week: "minggu ini", year: "tahun ini", custom: "bulan ini" };
      loadReport(map[btn.getAttribute("data-period")] || "bulan ini");
    };
  });
  $("#btnExportExcel").onclick = () => {
    showLoading("Menyiapkan file...");
    api("webExportExcel_", [S.token]).then(res => {
      hideLoading();
      toast(res.message || "File akan dikirim ke Telegram kamu.", res.ok ? "success" : "error");
    });
  };
  $("#btnExportPDF").onclick = () => toast("Export PDF langsung dari web belum tersedia. Pakai Export Excel (dikirim ke Telegram).");

  loadReport(periodeLabel || "bulan ini");
}

function loadReport(periode) {
  showLoading("Memuat laporan...");
  Promise.all([
    api("webGetLaporan_", [S.token, periode]),
    api("webGetTransaksi_", [S.token, 500]),
  ]).then(([lap, tx]) => {
    hideLoading();
    if (!lap.ok) { toast(lap.message || "Gagal memuat laporan.", "error"); }

    const list = (tx.ok ? tx.transaksi : []) || [];
    let income = 0, expense = 0;
    const perCat = {};
    list.forEach(t => {
      if (t.tipe === "Masuk") income += t.jumlah; else expense += t.jumlah;
      const c = perCat[t.kategori] || { masuk: 0, keluar: 0 };
      if (t.tipe === "Masuk") c.masuk += t.jumlah; else c.keluar += t.jumlah;
      perCat[t.kategori] = c;
    });
    $("#reportIncome").textContent = "+ " + fmtRp(income);
    $("#reportExpense").textContent = "- " + fmtRp(expense);
    $("#reportNet").textContent = fmtRp(income - expense);

    const total = income + expense || 1;
    const tbody = $("#reportCategoryTableBody");
    const rows = Object.entries(perCat).sort((a, b) => (b[1].keluar + b[1].masuk) - (a[1].keluar + a[1].masuk));
    tbody.innerHTML = rows.map(([kat, v]) => `
      <tr class="border-b-2 border-ink-black">
        <td class="p-3">${escapeHtml(kat)}</td>
        <td class="p-3 text-right text-tertiary">${fmtRp(v.keluar)}</td>
        <td class="p-3 text-right text-secondary">${fmtRp(v.masuk)}</td>
        <td class="p-3 text-right">${fmtRp(v.masuk - v.keluar)}</td>
        <td class="p-3 text-right">${Math.round(((v.keluar + v.masuk) / total) * 100)}%</td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="p-6 text-center text-on-surface-variant">Tidak ada data.</td></tr>`;

    const expenseEntries = rows.filter(([, v]) => v.keluar > 0).map(([k, v]) => [k, v.keluar]);
    const incomeEntries = rows.filter(([, v]) => v.masuk > 0).map(([k, v]) => [k, v.masuk]);
    toggleChartOrEmpty("reportExpenseChart", "reportExpenseChartEmpty", expenseEntries);
    toggleChartOrEmpty("reportIncomeChart", "reportIncomeChartEmpty", incomeEntries);
  });
}

function toggleChartOrEmpty(canvasId, emptyId, entries) {
  const canvas = document.getElementById(canvasId);
  const empty = document.getElementById(emptyId);
  if (!entries.length) { empty.style.display = "flex"; canvas.style.display = "none"; return; }
  empty.style.display = "none";
  canvas.style.display = "block";
  drawPie(canvas, entries);
}

/* ---------------------------------------------------------------
   PENGATURAN
--------------------------------------------------------------- */
function renderSettingsPage() {
  $("#settingsName").textContent = S.username || "-";
  $("#settingsTelegram").textContent = "Chat ID: " + (S.chatId || "-");
  api("webEmailInfo_", [S.token]).then(res => {
    $("#settingsEmail").textContent = S.email || "Belum ada email terhubung";
  });

  const dm = $("#darkModeToggle");
  dm.checked = document.documentElement.classList.contains("dark");
  dm.onchange = () => toggleDarkMode(dm.checked);

  $("#logoutBtn").onclick = () => doLogout(false);
}

function toggleDarkMode(on) {
  document.documentElement.classList.toggle("dark", on);
  localStorage.setItem("kb_theme", on ? "dark" : "light");
  $("#themeIcon").textContent = on ? "light_mode" : "dark_mode";
}

/* ---------------------------------------------------------------
   ADMIN
   Sekarang akses admin CUKUP lewat login web normal (OTP + konfirmasi
   Telegram) ASALKAN chatId-nya terdaftar sebagai developer di backend
   (DEVELOPER_CHAT_IDS). Link lama "?page=admin&token=adm_xxx" dari
   command "dev dashboard" di bot tetap didukung sbg fallback.
--------------------------------------------------------------- */
function adminTok() {
  return S.adminToken || S.token;
}

function renderAdminPage() {
  if (!S.isAdmin && !S.adminToken) {
    toast("Akses admin khusus developer. Login dulu lewat Telegram (chatId kamu harus terdaftar sbg developer).", "error");
    goToPage("dashboard");
    return;
  }
  showLoading("Memuat data admin...");
  api("webAdminGetData_", [adminTok()]).then(res => {
    hideLoading();
    if (!res.ok) { toast(res.message || "Akses admin ditolak.", "error"); S.isAdmin = false; S.adminToken = ""; localStorage.removeItem("kb_admin_token"); renderNavMenu(); goToPage("dashboard"); return; }

    $("#adminTotalUsers").textContent = res.stats.totalUser;
    $("#adminEmailLinked").textContent = res.stats.emailLinked;
    $("#adminReminderActive").textContent = res.stats.reminderAktif;
    $("#adminTransactionsToday").textContent = "-";

    $("#adminUsersTableBody").innerHTML = res.users.map(u => `
      <tr class="border-b-2 border-ink-black">

        <td class="p-3">${escapeHtml(u.username)}</td>
        <td class="p-3">${escapeHtml(u.chatId)}</td>
        <td class="p-3">${u.email ? "📧" : "-"}</td>
        <td class="p-3">${u.reminder ? "🔔" : "-"}</td>
        <td class="p-3">${escapeHtml(u.joined)}</td>
        <td class="p-3 text-center">-</td>
      </tr>`).join("") || `<tr><td colspan="6" class="p-6 text-center text-on-surface-variant">Belum ada user.</td></tr>`;

    $("#adminFeedbackTableBody").innerHTML = res.feedback.map(f => `
      <tr class="border-b-2 border-ink-black">
        <td class="p-3">${escapeHtml(f.waktu)}</td>
        <td class="p-3">${escapeHtml(f.user)}</td>
        <td class="p-3">${escapeHtml(f.pesan)}</td>
        <td class="p-3 text-center">-</td>
      </tr>`).join("") || `<tr><td colspan="4" class="p-6 text-center text-on-surface-variant">Belum ada masukan.</td></tr>`;

    $("#adminErrorsTableBody").innerHTML = res.errors.map(e => `
      <tr class="border-b-2 border-ink-black">
        <td class="p-3">${escapeHtml(e.waktu)}</td>
        <td class="p-3">${escapeHtml(e.chatId)}</td>
        <td class="p-3">${escapeHtml(e.error)}</td>
      </tr>`).join("") || `<tr><td colspan="3" class="p-6 text-center text-on-surface-variant">Tidak ada error.</td></tr>`;

    $("#maintenanceStatus").textContent = res.stats.maintenance ? "AKTIF" : "NONAKTIF";
    $("#btnToggleMaintenance").textContent = res.stats.maintenance ? "Nonaktifkan" : "Aktifkan";
    $("#btnToggleMaintenance").onclick = () => {
      showLoading("Mengubah status...");
      api("adminSetMaintenance_", [adminTok(), !res.stats.maintenance]).then(r => {
        hideLoading();
        toast(r.message || "", r.ok ? "success" : "error");
        if (r.ok) renderAdminPage();
      });
    };

    $("#strukMaxInput").value = res.stats.batasStruk || "";
    $("#btnSaveStrukMax").onclick = () => {
      const n = $("#strukMaxInput").value;
      api("adminSetStrukMax_", [adminTok(), n]).then(r => {
        $("#strukMaxStatus").textContent = r.message || "";
      });
    };

    $("#donasiSettings").innerHTML = res.donasi.map(d => `
      <div class="flex gap-2 items-center p-3 bg-surface-variant border-2 border-ink-black rounded-xl">
        <span class="w-40 font-label-md text-label-md">${escapeHtml(d.label)}</span>
        <input class="flex-1 brutal-input border-2 border-ink-black rounded-lg px-3 py-2 bg-paper-white" data-jenis="${d.jenis}" value="${escapeHtml(d.nilai)}" placeholder="Nomor/link">
        <button class="bg-primary text-on-primary border-2 border-ink-black rounded-lg px-3 py-2 text-sm" data-save="${d.jenis}">Simpan</button>
        <button class="bg-tertiary-container border-2 border-ink-black rounded-lg px-3 py-2 text-sm" data-hapus="${d.jenis}">Hapus</button>
      </div>`).join("");
    $("#donasiSettings").querySelectorAll("[data-save]").forEach(btn => {
      btn.addEventListener("click", () => {
        const jenis = btn.getAttribute("data-save");
        const val = document.querySelector(`[data-jenis="${jenis}"]`).value;
        api("adminSetDonasi_", [adminTok(), jenis, val]).then(r => toast(r.message || "", r.ok ? "success" : "error"));
      });
    });
    $("#donasiSettings").querySelectorAll("[data-hapus]").forEach(btn => {
      btn.addEventListener("click", () => {
        api("adminHapusDonasi_", [adminTok(), btn.getAttribute("data-hapus")]).then(r => { toast(r.message || "", r.ok ? "success" : "error"); renderAdminPage(); });
      });
    });
  });

  $("#btnRefreshAdmin").onclick = renderAdminPage;
  $("#btnSendBroadcast").onclick = () => {
    const msg = $("#broadcastMessage").value.trim();
    if (!msg) { toast("Isi pesan broadcast dulu.", "error"); return; }
    if (!confirm("Kirim pengumuman ini ke SEMUA user?")) return;
    showLoading("Mengirim broadcast...");
    api("adminBroadcast_", [adminTok(), msg]).then(r => {
      hideLoading();
      $("#broadcastStatus").textContent = r.message || "";
      toast(r.message || "", r.ok ? "success" : "error");
    });
  };
  $("#btnClearBroadcast").onclick = () => { $("#broadcastMessage").value = ""; };

  $all("#adminTabs .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $all("#adminTabs .tab-btn").forEach(b => b.classList.remove("active", "bg-primary", "text-on-primary"));
      btn.classList.add("active", "bg-primary", "text-on-primary");
      $all(".tab-panel").forEach(p => p.classList.add("hidden"));
      document.getElementById("tab" + btn.getAttribute("data-tab").charAt(0).toUpperCase() + btn.getAttribute("data-tab").slice(1)).classList.remove("hidden");
    });
  });
}

/* ---------------------------------------------------------------
   INIT
--------------------------------------------------------------- */
function initShellHandlers() {
  $("#menuBtn").addEventListener("click", openSidebar);
  $("#sidebarOverlay").addEventListener("click", closeSidebar);
  $("#themeToggle").addEventListener("click", () => toggleDarkMode(!document.documentElement.classList.contains("dark")));
  $all("[data-page]").forEach(btn => btn.addEventListener("click", () => goToPage(btn.getAttribute("data-page"))));
  $("#fabAdd").addEventListener("click", () => goToPage("addTransaction"));
}

function boot() {
  initShellHandlers();
  setupLoginPage();

  if (localStorage.getItem("kb_theme") === "dark") toggleDarkMode(true);

  const urlParams = new URLSearchParams(location.search);
  const adminTokenFromUrl = urlParams.get("page") === "admin" ? urlParams.get("token") : null;

  if (adminTokenFromUrl) {
    S.adminToken = adminTokenFromUrl;
    localStorage.setItem("kb_admin_token", adminTokenFromUrl);
    api("webAdminAuth_", [adminTokenFromUrl]).then(res => {
      if (res.ok) {
        S.isAdmin = true;
        renderNavMenu();
        if (S.token) { goToPage("admin"); } else { toast("Login sebagai user Telegram dulu untuk membuka menu lain, atau langsung lihat dashboard admin.", "success"); goToPage("admin"); }
      } else {
        toast(res.message || "Token admin tidak valid.", "error");
      }
    });
  }

  if (S.token) {
    api("webAuthCek_", [S.token]).then(res => {
      if (res.ok) {
        S.username = res.username;
        S.chatId = res.chatId;
        S.email = res.email;
        S.isAdmin = S.isAdmin || !!res.isAdmin;
        afterLogin();
      } else {
        localStorage.removeItem("kb_token");
        routeFreshVisit();
      }
    });
  } else if (!adminTokenFromUrl) {
    routeFreshVisit();
  }
}

// Kalau link dibuka langsung dari bot (mengandung ?code=...), langsung
// arahkan ke form verifikasi OTP dgn kode terisi, bukan ke halaman login
// biasa - biar user tidak perlu klik "Hubungkan Telegram ID" dulu.
function routeFreshVisit() {
  const hasCode = new URLSearchParams(location.search).get("code");
  if (hasCode) {
    goToLinkTelegramForm();
  } else {
    goToPage("login");
  }
}

document.addEventListener("DOMContentLoaded", boot);
