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

function getMe() {
  return db.activeIdentityId ? db.identities[db.activeIdentityId] : null;
}

function showOnboarding() {
  onboarding.classList.remove("hidden");
  app.classList.add("hidden");
  meBadge.classList.add("hidden");
}

function showApp() {
  onboarding.classList.add("hidden");
  app.classList.remove("hidden");
  meBadge.classList.remove("hidden");
  const me = getMe();
  meBadge.textContent = `@${me.handle} · ${me.name}`;
}

// ---------- Invite link handling ----------
function getInviteFromUrl() {
  const u = new URL(location.href);
  const conv = u.searchParams.get("room");
  return conv ? String(conv).trim() : null;
}

function clearInviteFromUrl() {
  const u = new URL(location.href);
  u.searchParams.delete("room");
  history.replaceState({}, "", u.toString());
}

function safeCopy(text) {
  return navigator.clipboard?.writeText(text).then(() => alert("Copied ✅")).catch(() => prompt("Copy:", text));
}

// ---------- BroadcastChannel realtime ----------
let roomChannel = null;
let roomId = null;

function openRoomChannel(convId) {
  if (roomChannel) roomChannel.close();
  roomId = convId;
  roomChannel = new BroadcastChannel(`notify_room_${convId}`);

  roomChannel.onmessage = async (ev) => {
    const msg = ev.data;
    if (!msg || msg.senderHandle === getMe()?.handle) return;

    if (msg.type === "CHAT_MESSAGE") {
      // append message to local db (so this tab sees it)
      addMessageLocal(convId, msg.payload, false);
      if (activeConv?.id === convId) renderMessages(convId);

      if (msg.payload.kind === "code") {
        onIncomingCode(msg.payload);
      } else {
        notifyDesktop("Notify", `${msg.senderHandle}: ${msg.payload.text}`);
      }
    }

    if (msg.type === "CALL_SIGNAL") {
      await onCallSignal(msg.payload);
    }

    if (msg.type === "CALL_PRESENCE") {
      onCallPresence(msg.payload);
    }
  };
}

function broadcast(type, payload) {
  if (!roomChannel) return;
  roomChannel.postMessage({
    type,
    senderHandle: getMe().handle,
    payload
  });
}

// ---------- Conversations / UI state ----------
let activeConv = null;

// ---------- Friends ----------
function friendsOfMe() {
  const me = getMe();
  return db.friends[me.id] || [];
}

function addFriend(handle) {
  const me = getMe();
  const list = new Set(db.friends[me.id] || []);
  list.add(handle);
  db.friends[me.id] = [...list];
  saveDB(db);
  renderFriends();
}

function renderFriends() {
  const list = friendsOfMe();
  friendsList.innerHTML = "";
  for (const h of list) {
    const el = document.createElement("div");
    el.className = "friendChip";
    el.innerHTML = `<div>@${h}</div><span>local</span>`;
    friendsList.appendChild(el);
  }
}

addFriendBtn.onclick = () => {
  const h = cleanHandle(friendHandleInput.value);
  if (!h) return;
  addFriend(h);
  friendHandleInput.value = "";
};

// ---------- Conversations CRUD ----------
function myConversations() {
  const me = getMe();
  return Object.values(db.conversations)
    .filter(c => c.members.includes(me.handle))
    .sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function createConversation({type, name, members}) {
  const convId = id("room");
  const conv = {
    id: convId,
    type,
    name: name || (type === "group" ? "Group" : "DM"),
    members: [...new Set(members)],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  db.conversations[convId] = conv;
  db.messages[convId] = [];
  db.codes[convId] = defaultCodes();
  saveDB(db);
  return conv;
}

function defaultCodes() {
  return [
    { id: id("code"), name: "SOS", mode: "CALL", colorHex: "#ff2d2d", sound: "sos", text: "I need help now." },
    { id: id("code"), name: "PICK ME UP", mode: "MESSAGE", colorHex: "#ffb020", sound: "ping", text: "Call me with an excuse." },
    { id: id("code"), name: "CHECK IN", mode: "NOTIFICATION", colorHex: "#2dd4ff", sound: "soft", text: "Check in with me." }
  ];
}

function convDisplayName(c) {
  if (c.type === "group") return c.name || "Group";
  // dm: show the other handle
  const me = getMe();
  const other = c.members.find(x => x !== me.handle) || "DM";
  return `DM · @${other}`;
}

function renderConversationList() {
  const convs = myConversations();
  chatList.innerHTML = "";

  for (const c of convs) {
    const div = document.createElement("div");
    div.className = "chatItem" + (activeConv?.id === c.id ? " active" : "");
    const preview = (db.messages[c.id] || []).slice(-1)[0]?.text || "";

    div.innerHTML = `
      <div class="chatItemTop">
        <div class="chatName">${convDisplayName(c)}</div>
        <div class="chatType">${c.type.toUpperCase()}</div>
      </div>
      <div class="chatPreview">${preview}</div>
    `;
    div.onclick = () => selectConversation(c.id);
    chatList.appendChild(div);
  }
}

function showEmptyState() {
  emptyState.classList.remove("hidden");
  chatView.classList.add("hidden");
  activeConv = null;
}

function selectConversation(convId) {
  const conv = db.conversations[convId];
  if (!conv) return;

  activeConv = conv;
  emptyState.classList.add("hidden");
  chatView.classList.remove("hidden");

  chatTitle.textContent = convDisplayName(conv);
  chatMeta.textContent = conv.type === "group"
    ? `${conv.members.length} members`
    : `Direct message`;

  openRoomChannel(convId);
  renderConversationList();
  renderMessages(convId);
  renderCodes(convId);

  // If URL contains invite to this room, clear it
  const inv = getInviteFromUrl();
  if (inv === convId) clearInviteFromUrl();
}

// Buttons to create chats
newGroupBtn.onclick = () => {
  const name = prompt("Group name:", "My group");
  if (!name) return;
  const me = getMe();
  const conv = createConversation({ type: "group", name, members: [me.handle] });
  selectConversation(conv.id);
  renderConversationList();
};

newDmBtn.onclick = () => {
  const me = getMe();
  const target = cleanHandle(prompt("Friend handle (local):", ""));
  if (!target) return;

  // must be in your local friends list for this prototype
  if (!friendsOfMe().includes(target)) {
    const ok = confirm("That handle isn't in your local friends list. Add anyway?");
    if (!ok) return;
  }

  const conv = createConversation({ type: "dm", name: "DM", members: [me.handle, target] });
  selectConversation(conv.id);
  renderConversationList();
};

// Invite link button
inviteBtn.onclick = async () => {
  if (!activeConv) return;
  const link = `${location.origin}${location.pathname}?room=${activeConv.id}`;
  await safeCopy(link);
};

// ---------- Messages ----------
function addMessageLocal(convId, message, bumpUpdated = true) {
  db.messages[convId] = db.messages[convId] || [];
  db.messages[convId].push(message);
  if (bumpUpdated) {
    db.conversations[convId].updatedAt = Date.now();
  }
  saveDB(db);
}

function sendText() {
  if (!activeConv) return;
  const text = String(messageInput.value || "").trim();
  if (!text) return;

  const me = getMe();
  const msg = {
    id: id("m"),
    kind: "text",
    text,
    senderHandle: me.handle,
    senderName: me.name,
    createdAt: Date.now()
  };

  addMessageLocal(activeConv.id, msg, true);
  broadcast("CHAT_MESSAGE", msg);

  messageInput.value = "";
  renderMessages(activeConv.id);
  renderConversationList();
}

sendBtn.onclick = sendText;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendText();
});

function renderMessages(convId) {
  const list = db.messages[convId] || [];
  const me = getMe();

  messagesEl.innerHTML = "";
  for (const m of list) {
    const isMe = m.senderHandle === me.handle;

    const b = document.createElement("div");
    b.className = "bubble" + (isMe ? " me" : "") + (m.kind === "code" ? " codeBubble" : "");
    if (m.kind === "code" && m.colorHex) b.style.borderLeftColor = m.colorHex;

    const top = document.createElement("div");
    top.className = "bubbleTop";
    top.innerHTML = `
      <div class="bubbleName">${m.senderName || m.senderHandle}</div>
      <div class="bubbleTime">${nowTime(new Date(m.createdAt))}</div>
    `;

    const txt = document.createElement("div");
    txt.className = "bubbleText";
    txt.textContent = m.text || "";

    b.appendChild(top);
    b.appendChild(txt);
    messagesEl.appendChild(b);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- Codes ----------
function renderCodes(convId) {
  const codes = db.codes[convId] || [];
  codesList.innerHTML = "";

  for (const c of codes) {
    const row = document.createElement("div");
    row.className = "codeRow";
    row.innerHTML = `
      <div class="codeLeft">
        <div class="codeName">${c.name}</div>
        <div class="codeMeta">
          <span class="dot" style="background:${c.colorHex || "#2dd4ff"}"></span>
          <span>${c.mode} • ${c.sound}</span>
        </div>
      </div>
    `;

    const btn = document.createElement("button");
    btn.className = "pill danger";
    btn.textContent = "Trigger";
    btn.onclick = () => triggerCode(c);

    row.appendChild(btn);
    codesList.appendChild(row);
  }
}

saveCodeBtn.onclick = () => {
  if (!activeConv) return;

  const n = String(codeName.value || "").trim().slice(0, 40);
  if (!n) return alert("Code name is required.");

  const c = {
    id: id("code"),
    name: n,
    mode: codeMode.value,
    colorHex: codeColor.value,
    sound: codeSound.value,
    text: String(codeText.value || "").trim().slice(0, 200),
  };

  db.codes[activeConv.id] = db.codes[activeConv.id] || [];
  db.codes[activeConv.id].push(c);
  saveDB(db);

  codeName.value = "";
  codeText.value = "";
  renderCodes(activeConv.id);
};

function triggerCode(code) {
  if (!activeConv) return;

  const override = prompt("Optional override text (blank uses default):", "") || "";
  const text = override.trim() || code.text || `${code.name}`;

  const me = getMe();
  const msg = {
    id: id("m"),
    kind: "code",
    codeName: code.name,
    mode: code.mode,
    colorHex: code.colorHex,
    sound: code.sound,
    text,
    senderHandle: me.handle,
    senderName: me.name,
    createdAt: Date.now()
  };

  addMessageLocal(activeConv.id, msg, true);
  broadcast("CHAT_MESSAGE", msg);

  // local immediate feedback
  playTone(code.sound || "sos");
  if (code.mode === "NOTIFICATION") notifyDesktop(`Notify code: ${code.name}`, `${me.handle}: ${text}`);
  if (code.mode === "CALL") openCall(); // open call on sender too

  renderMessages(activeConv.id);
  renderConversationList();
}

function onIncomingCode(m) {
  playTone(m.sound || "sos");
  notifyDesktop(`Notify code: ${m.codeName}`, `${m.senderName}: ${m.text}`);

  showIncomingOverlay(m);
}

function showIncomingOverlay(m) {
  incomingOverlay.classList.remove("hidden");

  const card = incomingOverlay.querySelector(".overlayCard");
  card.style.boxShadow = `0 18px 60px rgba(0,0,0,.55), 0 0 0 2px ${(m.colorHex || "#2dd4ff")}66`;
  card.style.borderColor = `${(m.colorHex || "#2dd4ff")}55`;

  incomingTitle.textContent = m.codeName || "CODE";
  incomingFrom.textContent = `From: ${m.senderName} (@${m.senderHandle})`;
  incomingText.textContent = m.text || "";

  incomingOpenBtn.onclick = () => {
    incomingOverlay.classList.add("hidden");
    if (m.mode === "CALL") openCall();
  };
  incomingDismissBtn.onclick = () => incomingOverlay.classList.add("hidden");
}

// ---------- Meet-like Calls (WebRTC + BroadcastChannel signaling) ----------
const RTC_CFG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let inCall = false;
let localStream = null;
let screenStream = null;
let peers = new Map(); // peerHandle -> RTCPeerConnection
let presence = new Map(); // peerHandle -> {inCall:true}

callBtn.onclick = openCall;
leaveCallBtn.onclick = leaveCall;
micBtn.onclick = toggleMic;
camBtn.onclick = toggleCam;
shareBtn.onclick = toggleShare;

function addTile(label, stream, isMe) {
  let tile = document.querySelector(`[data-tile="${label}"]`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.tile = label;

    const v = document.createElement("video");
    v.autoplay = true;
    v.playsInline = true;
    if (isMe) v.muted = true;

    const l = document.createElement("div");
    l.className = "label";
    l.textContent = isMe ? `${label} (You)` : label;

    tile.appendChild(v);
    tile.appendChild(l);
    videoGrid.appendChild(tile);
  }
  tile.querySelector("video").srcObject = stream;
}

function removeTile(label) {
  const t = document.querySelector(`[data-tile="${label}"]`);
  if (t) t.remove();
}

async function ensureLocalMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  addTile(getMe().name, localStream, true);
  return localStream;
}

async function openCall() {
  if (!activeConv) return alert("Select a chat first.");
  if (inCall) return;

  await ensureLocalMedia();

  inCall = true;
  callModal.classList.remove("hidden");
  callRoomTitle.textContent = `Meet Call · ${convDisplayName(activeConv)}`;
  callRoomSub.textContent = `Room: ${activeConv.id} (same-device tabs only)`;

  // announce presence
  broadcast("CALL_PRESENCE", { roomId: activeConv.id, handle: getMe().handle, inCall: true });

  // create peers for everyone we already know is in the call
  for (const [h, p] of presence.entries()) {
    if (p.inCall && h !== getMe().handle) await ensurePeer(h);
  }

  // deterministic initiator rule (avoids “offer glare”):
  // the lexicographically larger handle offers.
  for (const [h, p] of presence.entries()) {
    if (p.inCall && h !== getMe().handle) {
      if (getMe().handle > h) {
        await makeOffer(h);
      }
    }
  }
}

async function leaveCall() {
  if (!inCall) return;
  inCall = false;

  broadcast("CALL_PRESENCE", { roomId: activeConv?.id, handle: getMe().handle, inCall: false });

  // close pcs
  for (const h of peers.keys()) closePeer(h);
  peers.clear();

  // stop streams
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  videoGrid.innerHTML = "";
  callModal.classList.add("hidden");
}

function toggleMic() {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  micBtn.textContent = t.enabled ? "Mic" : "Mic (muted)";
}

function toggleCam() {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  camBtn.textContent = t.enabled ? "Cam" : "Cam (off)";
}

async function toggleShare() {
  if (!inCall || !localStream) return;

  if (!screenStream) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = screenStream.getVideoTracks()[0];

      for (const pc of peers.values()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(screenTrack);
      }

      const mixed = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
      addTile(getMe().name, mixed, true);

      screenTrack.onended = async () => stopShare();
      shareBtn.textContent = "Share (on)";
    } catch {
      screenStream = null;
    }
  } else {
    await stopShare();
  }
}

async function stopShare() {
  if (!screenStream || !localStream) return;
  const camTrack = localStream.getVideoTracks()[0];

  for (const pc of peers.values()) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) await sender.replaceTrack(camTrack);
  }

  screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;

  addTile(getMe().name, localStream, true);
  shareBtn.textContent = "Share";
}

async function ensurePeer(peerHandle) {
  if (peers.has(peerHandle)) return peers.get(peerHandle);

  const pc = new RTCPeerConnection(RTC_CFG);

  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    broadcast("CALL_SIGNAL", {
      roomId: activeConv.id,
      to: peerHandle,
      from: getMe().handle,
      kind: "ice",
      candidate: e.candidate.toJSON()
    });
  };

  pc.ontrack = (e) => {
    const [stream] = e.streams;
    addTile(`@${peerHandle}`, stream, false);
  };

  // add local tracks
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  peers.set(peerHandle, pc);
  return pc;
}

async function makeOffer(peerHandle) {
  const pc = await ensurePeer(peerHandle);
  if (pc.signalingState !== "stable") return;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  broadcast("CALL_SIGNAL", {
    roomId: activeConv.id,
    to: peerHandle,
    from: getMe().handle,
    kind: "offer",
    sdp: pc.localDescription.toJSON()
  });
}

async function onCallSignal(payload) {
  if (!activeConv || payload.roomId !== activeConv.id) return;
  if (payload.to !== getMe().handle) return;

  // If not in call yet, open the call UI automatically
  if (!inCall) {
    // Best-effort: open call and get media
    await openCall();
  }

  const peerHandle = payload.from;
  const pc = await ensurePeer(peerHandle);

  if (payload.kind === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    broadcast("CALL_SIGNAL", {
      roomId: activeConv.id,
      to: peerHandle,
      from: getMe().handle,
      kind: "answer",
      sdp: pc.localDescription.toJSON()
    });
  }

  if (payload.kind === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  }

  if (payload.kind === "ice") {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch {}
  }
}

function onCallPresence(payload) {
  if (!activeConv || payload.roomId !== activeConv.id) return;
  if (!payload?.handle) return;

  presence.set(payload.handle, { inCall: !!payload.inCall });

  // If I'm in a call and someone joined, create a peer
  if (inCall && payload.inCall && payload.handle !== getMe().handle) {
    ensurePeer(payload.handle).then(() => {
      if (getMe().handle > payload.handle) makeOffer(payload.handle);
    });
  }

  // If someone left, close peer
  if (!payload.inCall && peers.has(payload.handle)) {
    closePeer(payload.handle);
  }
}

function closePeer(peerHandle) {
  const pc = peers.get(peerHandle);
  if (pc) pc.close();
  peers.delete(peerHandle);
  removeTile(`@${peerHandle}`);
}

// ---------- Identity / Boot ----------
function setActiveIdentity(identityId) {
  db.activeIdentityId = identityId;
  saveDB(db);
}

function createIdentity(handle, name) {
  const identityId = id("me");
  db.identities[identityId] = { id: identityId, handle, name };
  db.friends[identityId] = db.friends[identityId] || [];
  setActiveIdentity(identityId);
  saveDB(db);
}

saveProfileBtn.onclick = () => {
  const handle = cleanHandle(handleInput.value);
  const name = String(nameInput.value || "").trim().slice(0, 40);
  if (handle.length < 3) return alert("Handle must be at least 3 characters.");
  if (!name) return alert("Enter a display name.");

  // unique per device
  const taken = Object.values(db.identities).some(x => x.handle === handle);
  if (taken) return alert("Handle already used on this device. Use another handle.");

  createIdentity(handle, name);
  startApp();
};

newIdentityBtn.onclick = () => {
  // “No verification” = you can create multiple identities quickly for demo testing
  localStorage.removeItem(LS_KEY);
  db = loadDB();
  location.reload();
};

function startApp() {
  showApp();
  renderFriends();
  renderConversationList();

  const inviteRoom = getInviteFromUrl();
  if (inviteRoom) {
    // If room exists locally, join it by adding your handle to members
    // If it doesn't exist, create it as a group placeholder so tabs can sync.
    const me = getMe();
    if (!db.conversations[inviteRoom]) {
      db.conversations[inviteRoom] = {
        id: inviteRoom,
        type: "group",
        name: "Invited group",
        members: [me.handle],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      db.messages[inviteRoom] = [];
      db.codes[inviteRoom] = defaultCodes();
      saveDB(db);
    } else {
      const c = db.conversations[inviteRoom];
      if (!c.members.includes(me.handle)) c.members.push(me.handle);
      c.updatedAt = Date.now();
      saveDB(db);
    }

    selectConversation(inviteRoom);
  } else {
    showEmptyState();
  }
}

(function boot() {
  const me = getMe();
  if (me) startApp();
  else showOnboarding();
})();
