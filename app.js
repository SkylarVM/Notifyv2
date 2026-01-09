/*******************************************************
 * Notify — no backend prototype
 * - Data stored in localStorage
 * - Realtime between tabs/windows (same device) via BroadcastChannel
 * - Invite links join rooms on same device/browser
 * - WebRTC calls: signaling via BroadcastChannel (same device)
 *******************************************************/

const $ = (id) => document.getElementById(id);

// UI
const onboarding = $("onboarding");
const app = $("app");

const enableAlertsBtn = $("enableAlertsBtn");
const newIdentityBtn = $("newIdentityBtn");
const meBadge = $("meBadge");

const handleInput = $("handleInput");
const nameInput = $("nameInput");
const saveProfileBtn = $("saveProfileBtn");

const newDmBtn = $("newDmBtn");
const newGroupBtn = $("newGroupBtn");
const chatList = $("chatList");

const friendHandleInput = $("friendHandleInput");
const addFriendBtn = $("addFriendBtn");
const friendsList = $("friendsList");

const emptyState = $("emptyState");
const chatView = $("chatView");
const chatTitle = $("chatTitle");
const chatMeta = $("chatMeta");

const inviteBtn = $("inviteBtn");
const callBtn = $("callBtn");

const messagesEl = $("messages");
const messageInput = $("messageInput");
const sendBtn = $("sendBtn");

const codesList = $("codesList");
const codeName = $("codeName");
const codeMode = $("codeMode");
const codeColor = $("codeColor");
const codeSound = $("codeSound");
const codeText = $("codeText");
const saveCodeBtn = $("saveCodeBtn");

const incomingOverlay = $("incomingOverlay");
const incomingTitle = $("incomingTitle");
const incomingFrom = $("incomingFrom");
const incomingText = $("incomingText");
const incomingOpenBtn = $("incomingOpenBtn");
const incomingDismissBtn = $("incomingDismissBtn");

const callModal = $("callModal");
const callRoomTitle = $("callRoomTitle");
const callRoomSub = $("callRoomSub");
const leaveCallBtn = $("leaveCallBtn");
const videoGrid = $("videoGrid");
const micBtn = $("micBtn");
const camBtn = $("camBtn");
const shareBtn = $("shareBtn");

// ---------- Alerts ----------
let audioEnabled = false;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

async function enableAlerts() {
  try {
    ensureAudio();
    await audioCtx.resume();
    audioEnabled = true;
    enableAlertsBtn.textContent = "Alerts enabled ✅";
    playTone("ping");
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    alert("Browser blocked audio. Try clicking Enable alerts again.");
  }
}
enableAlertsBtn.onclick = enableAlerts;

function playTone(soundKey) {
  if (!audioEnabled) return;
  ensureAudio();

  const patterns = {
    sos: [880, 880, 880, 660, 660, 660, 880, 880, 880],
    ping: [880, 1320, 880],
    soft: [440, 550, 440],
  };
  const seq = patterns[soundKey] || patterns.sos;

  let t = audioCtx.currentTime;
  for (const f of seq) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(audioCtx.destination);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);

    o.start(t);
    o.stop(t + 0.22);
    t += 0.24;
  }
}

function notifyDesktop(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  new Notification(title, { body });
}

// ---------- Local Storage DB ----------
const LS_KEY = "notify_nobackend_v1";

function loadDB() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return {
    identities: {}, // identityId -> {id, handle, name}
    activeIdentityId: null,
    friends: {}, // identityId -> [handle]
    conversations: {}, // convId -> {id, type, name, members: [handle], createdAt, updatedAt}
    messages: {}, // convId -> [{id, kind, text, ...}]
    codes: {},    // convId -> [{id, name, mode, colorHex, sound, text}]
  };
  try { return JSON.parse(raw); } catch { return null; }
}

function saveDB(db) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

let db = loadDB();
if (!db) {
  localStorage.removeItem(LS_KEY);
  db = loadDB();
}

function id(prefix="id") {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function cleanHandle(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
}

function nowTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
