// ======================================================
// === ГЛОБАЛЬНІ ЗМІННІ
// ======================================================
let activeChatRecipientId = null;
let isTyping = false;
let typingTimeout = null;
let replyToMessage = null;

const allUsers = {};
const chatHistories = {};
const unreadCounts = {};
const online_users = new Set();

let socket;
const DOM = {};

// ЗАПАСНИЙ КЛЮЧ (якщо з сервера прийде пустота)
const FALLBACK_GIPHY_KEY = 'dc6zaTOxFJmzC'; 
let GIPHY_API_KEY = FALLBACK_GIPHY_KEY;

// ======================================================
// === ІНІЦІАЛІЗАЦІЯ
// ======================================================
function init() {
    console.log("Chat initialized v4");
    socket = io();
    
    const wrapper = document.getElementById('content-wrapper');
    if (wrapper) {
        window.currentUserId = parseInt(wrapper.dataset.currentUserId, 10);
        // Пробуємо взяти ключ з HTML, якщо є
        const serverKey = wrapper.dataset.giphyKey;
        if(serverKey && serverKey.length > 5) GIPHY_API_KEY = serverKey;
    }

    // DOM Elements
    DOM.userList = document.getElementById('user-list');
    DOM.searchInput = document.getElementById('user-search-input');
    DOM.messages = document.getElementById('messages');
    DOM.input = document.getElementById('message_input');
    DOM.sendBtn = document.getElementById('send_button');
    DOM.chatTitle = document.getElementById('chat-with-title');
    DOM.chatStatus = document.getElementById('chat-with-status');
    DOM.titleWrapper = document.getElementById('chat-title-wrapper');
    DOM.backBtn = document.getElementById('back-to-chats-btn');
    DOM.fileInput = document.getElementById('file_input');
    
    // Reply
    DOM.replyIndicator = document.getElementById('reply-indicator');
    DOM.replyAuthor = document.getElementById('reply-indicator-author');
    DOM.replyText = document.getElementById('reply-indicator-text');
    DOM.replyCancel = document.getElementById('reply-cancel-btn');

    // GIF
    DOM.gifButton = document.getElementById('gif_button');
    DOM.gifModal = document.getElementById('gif-modal');
    DOM.gifLibrary = document.getElementById('gif-library');
    DOM.gifSearchInput = document.getElementById('gif-search-input');
    DOM.gifSearchButton = document.getElementById('gif-search-button');
    DOM.gifCloseButton = document.getElementById('gif-close-button');

    // Listeners
    if(DOM.userList) DOM.userList.addEventListener('click', handleUserClick);
    if(DOM.searchInput) DOM.searchInput.addEventListener('input', debounce(handleSearch, 500));
    if(DOM.sendBtn) DOM.sendBtn.addEventListener('click', sendMessage);
    
    if(DOM.input) {
        DOM.input.addEventListener('keypress', (e) => {
            if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        DOM.input.addEventListener('input', handleTyping);
    }

    if(DOM.fileInput) DOM.fileInput.addEventListener('change', handleFileSelect);
    if(DOM.replyCancel) DOM.replyCancel.addEventListener('click', hideReplyIndicator);

    // GIF Handlers
    if(DOM.gifButton) DOM.gifButton.addEventListener('click', openGifModal);
    if(DOM.gifCloseButton) DOM.gifCloseButton.addEventListener('click', closeGifModal);
    if(DOM.gifModal) DOM.gifModal.addEventListener('click', (e) => { if(e.target === DOM.gifModal) closeGifModal(); });
    if(DOM.gifLibrary) DOM.gifLibrary.addEventListener('click', handleGifSelect);
    if(DOM.gifSearchButton) DOM.gifSearchButton.addEventListener('click', searchGifs);
    if(DOM.gifSearchInput) {
        DOM.gifSearchInput.addEventListener('keypress', (e) => {
            if(e.key === 'Enter') { e.preventDefault(); searchGifs(); }
        });
    }
    
    document.querySelectorAll('.gif-tab').forEach(t => {
        t.addEventListener('click', (e) => switchGifTab(e.target.dataset.tab));
    });

    if(DOM.backBtn) {
        DOM.backBtn.addEventListener('click', () => {
            document.getElementById('content-wrapper').classList.remove('chat-view-active');
            activeChatRecipientId = null;
        });
    }

    // GLOBAL CLICK to close menus
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.message-context-menu') && !e.target.closest('.emoji-picker')) {
            document.querySelectorAll('.emoji-picker').forEach(el => el.style.display = 'none');
        }
    });

    setupSocketHandlers();
}

// ======================================================
// === CHAT LOGIC
// ======================================================
function handleUserClick(e) {
    const li = e.target.closest('.user-item');
    if (!li) return;
    
    const uid = parseInt(li.dataset.id);
    const username = li.dataset.username || "User";
    
    activeChatRecipientId = uid;
    
    document.querySelectorAll('.user-item').forEach(i => i.classList.remove('active'));
    li.classList.add('active');
    document.getElementById('content-wrapper').classList.add('chat-view-active');
    
    if (DOM.chatTitle) DOM.chatTitle.innerText = username;
    
    const user = allUsers[uid];
    const isOnline = online_users.has(uid);
    if(DOM.chatStatus) {
        DOM.chatStatus.innerText = isOnline ? 'Онлайн' : (user ? formatLastSeen(user.last_seen) : '');
        DOM.chatStatus.className = isOnline ? 'chat-status-subtitle online' : 'chat-status-subtitle';
    }

    createChatHeaderAvatar(user || {username: username, id: uid});

    DOM.input.disabled = false;
    DOM.sendBtn.disabled = false;
    if(DOM.gifButton) DOM.gifButton.disabled = false;
    DOM.input.placeholder = `Напишіть ${username}...`;
    DOM.input.focus();

    unreadCounts[uid] = 0;
    const badge = li.querySelector('.unread-badge');
    if(badge) badge.style.display = 'none';
    socket.emit('mark_as_read', {chat_partner_id: uid});

    if (chatHistories[uid]) {
        renderMessages(chatHistories[uid]);
    } else {
        DOM.messages.innerHTML = '<li class="status">Завантаження історії...</li>';
        socket.emit('load_history', {partner_id: uid});
    }
    
    if(DOM.searchInput.value.trim().length > 0) {
        DOM.searchInput.value = '';
        socket.emit('users_list_request');
    }
}

function handleSearch(e) {
    const q = e.target.value.trim();
    if (q.length < 2) {
        if (q.length === 0) socket.emit('users_list_request');
        return;
    }
    DOM.userList.innerHTML = '<li class="status">Пошук...</li>';
    fetch('/search_users', {
        method: 'POST', 
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: q})
    })
    .then(r => r.json())
    .then(data => renderUserList(data.users, 'search'))
    .catch(() => DOM.userList.innerHTML = '<li class="status">Помилка</li>');
}

function renderUserList(users, type='chats') {
    DOM.userList.innerHTML = '';
    if (users.length === 0) {
        DOM.userList.innerHTML = `<li class="status">${type==='search'?'Нікого не знайдено':'У вас ще немає чатів'}</li>`;
        return;
    }
    
    users.forEach(u => {
        allUsers[u.id] = u;
        const li = document.createElement('li');
        li.className = `user-item ${online_users.has(u.id) ? 'online' : ''}`;
        if (u.id === activeChatRecipientId) li.classList.add('active');
        li.dataset.id = u.id;
        li.dataset.username = u.display_name || u.username;
        
        const avatar = u.avatar_url 
            ? `<img src="${u.avatar_url}" class="user-avatar-img">` 
            : `<div class="user-avatar-placeholder">${u.username[0].toUpperCase()}</div>`;
        
        let subText = type==='chats' ? `<span class="last-message">${u.last_message_text || ''}</span>` : `<span class="last-seen">${u.username}</span>`;
        const count = unreadCounts[u.id] || 0;
        
        li.innerHTML = `
            <div class="avatar-wrapper"><div class="user-avatar-container">${avatar}</div><div class="status-dot"></div></div>
            <div class="user-info"><span class="username">${u.display_name || u.username}</span>${subText}</div>
            <span class="unread-badge" style="display:${count>0?'block':'none'}">${count}</span>
        `;
        DOM.userList.appendChild(li);
    });
}

// ======================================================
// === SOCKETS
// ======================================================
function setupSocketHandlers() {
    socket.on('connect', () => console.log('Connected'));
    
    socket.on('users_list', data => {
        online_users.clear();
        data.online_ids.forEach(id => online_users.add(id));
        if(DOM.searchInput.value.trim().length === 0) renderUserList(data.users, 'chats');
    });
    
    socket.on('new_message', data => {
        const pid = (data.sender_id === window.currentUserId) ? data.recipient_id : data.sender_id;
        if(!chatHistories[pid]) chatHistories[pid] = [];
        chatHistories[pid].push(data);
        
        if(pid === activeChatRecipientId) {
            if(DOM.messages.querySelector('.status')) DOM.messages.innerHTML = '';
            appendMessage(data, true);
            if(data.sender_id !== window.currentUserId) socket.emit('mark_as_read', {chat_partner_id: pid});
        } else if (data.sender_id !== window.currentUserId) {
            unreadCounts[pid] = (unreadCounts[pid] || 0) + 1;
            const li = document.querySelector(`.user-item[data-id="${pid}"]`);
            if(li) {
                li.querySelector('.unread-badge').innerText = unreadCounts[pid];
                li.querySelector('.unread-badge').style.display = 'block';
                li.querySelector('.last-message').innerText = data.media_type==='text'?data.text:`[${data.media_type}]`;
            }
        }
    });
    
    socket.on('history_loaded', data => {
        chatHistories[data.partner_id] = data.history;
        if(activeChatRecipientId === data.partner_id) renderMessages(data.history);
    });
    
    socket.on('user_status_change', data => {
        if(data.status === 'online') online_users.add(data.user_id); else online_users.delete(data.user_id);
        
        if(activeChatRecipientId === data.user_id && DOM.chatStatus) {
            DOM.chatStatus.innerText = (data.status === 'online') ? 'Онлайн' : formatLastSeen(data.last_seen);
            DOM.chatStatus.className = `chat-status-subtitle ${data.status === 'online' ? 'online' : ''}`;
        }
        const li = document.querySelector(`.user-item[data-id="${data.user_id}"]`);
        if(li) (data.status === 'online') ? li.classList.add('online') : li.classList.remove('online');
    });

    socket.on('reaction_updated', data => {
        for(let uid in chatHistories) {
            let m = chatHistories[uid].find(x => x.id === data.message_id);
            if(m) { m.reactions = data.reactions; break; }
        }
        if(activeChatRecipientId) {
            const li = document.querySelector(`li[data-message-id="${data.message_id}"]`);
            if(li) {
                const old = li.querySelector('.message-reactions'); if(old) old.remove();
                if(Object.keys(data.reactions).length > 0) {
                    let h = '<div class="message-reactions">';
                    for(let [e, u] of Object.entries(data.reactions)) {
                        const my = u.some(x => x.user_id === window.currentUserId);
                        h += `<span class="reaction-item ${my?'my-reaction':''}" onclick="window.react(${data.message_id}, '${e}')"><span class="reaction-emoji">${e}</span><span class="reaction-count">${u.length}</span></span>`;
                    }
                    h += '</div>';
                    li.querySelector('.timestamp').insertAdjacentHTML('beforebegin', h);
                }
            }
        }
    });
    
    socket.on('message_deleted', data => {
        const pid = (data.sender_id === window.currentUserId) ? data.recipient_id : data.sender_id;
        if(chatHistories[pid]) {
            const m = chatHistories[pid].find(x => x.id === data.id);
            if(m) m.is_deleted = true;
        }
        if(pid === activeChatRecipientId) {
            const li = document.querySelector(`li[data-message-id="${data.id}"]`);
            if(li) {
                li.classList.add('deleted');
                li.innerHTML = `<span>🚫 Повідомлення видалено</span><span class="timestamp">${formatUTCToLocal(data.timestamp)}</span>`;
            }
        }
    });
    
    socket.on('my_gifs_loaded', data => {
        DOM.gifLibrary.innerHTML = '';
        if(data.gifs.length === 0) {
             DOM.gifLibrary.innerHTML = '<div class="gif-loading">Ви ще не відправляли GIF</div>';
             return;
        }
        data.gifs.forEach(url => {
             const img = document.createElement('img');
             img.src = url;
             img.className = 'gif-item';
             DOM.gifLibrary.appendChild(img);
        });
    });
}

function renderMessages(history) {
    DOM.messages.innerHTML = '';
    if(!history || history.length === 0) {
        DOM.messages.innerHTML = '<li class="status">Тут поки що пусто.</li>'; return;
    }
    history.forEach(msg => appendMessage(msg, false));
    scrollToBottom();
}

function appendMessage(msg, scroll=true) {
    const li = document.createElement('li');
    li.className = msg.sender_id === window.currentUserId ? 'my-message' : '';
    if(msg.is_deleted) li.classList.add('deleted');
    li.dataset.messageId = msg.id;
    
    let content = msg.is_deleted ? '🚫 Повідомлення видалено' : '';
    
    if (!msg.is_deleted) {
        if(msg.reply_to) {
             content += `<div class="message-reply-container"><div class="message-reply-author">${msg.reply_to.sender_name}</div><div class="message-reply-text">${msg.reply_to.is_deleted?'Видалено':msg.reply_to.text||'[Media]'}</div></div>`;
        }
        if(msg.forwarded_from) content += `<div class="message-forwarded">📤 Forwarded from ${msg.forwarded_from.sender_name}</div>`;
        
        if(['image','gif'].includes(msg.media_type)) content += `<img src="${msg.media_url||msg.text}" class="chat-image" onclick="window.open(this.src)">`;
        else if(msg.media_type === 'video') content += `<video src="${msg.media_url}" class="chat-video" controls></video>`;
        else content += `<div>${(msg.text||"").replace(/\n/g, '<br>')}</div>`;
    }

    let reactionsHTML = '';
    if(msg.reactions && Object.keys(msg.reactions).length > 0) {
        reactionsHTML = '<div class="message-reactions">';
        for(let [e, u] of Object.entries(msg.reactions)) {
            const my = u.some(x => x.user_id === window.currentUserId);
            reactionsHTML += `<span class="reaction-item ${my?'my-reaction':''}" onclick="window.react(${msg.id}, '${e}')"><span class="reaction-emoji">${e}</span><span class="reaction-count">${u.length}</span></span>`;
        }
        reactionsHTML += '</div>';
    }

    const time = formatUTCToLocal(msg.timestamp);
    const read = (msg.sender_id === window.currentUserId) ? `<span class="read-status ${msg.is_read?'read':''}">${msg.is_read?'✓✓':'✓'}</span>` : '';
    
    const menu = !msg.is_deleted ? `
        <div class="message-context-menu">
            <button class="context-menu-btn" onclick="window.reply(${msg.id})">↩️</button>
            <button class="context-menu-btn" onclick="window.toggleReactions(${msg.id}, event)">😀</button>
            ${msg.sender_id===window.currentUserId ? `<button class="context-menu-btn delete-btn" onclick="window.del(${msg.id})">🗑️</button>` : ''}
        </div>
        <div class="emoji-picker" id="emoji-${msg.id}">
            <div class="emoji-picker-grid">
                ${['❤️','👍','😂','😮','😢','😡','🔥','🎉'].map(e => 
                    `<span class="emoji-picker-item" onclick="window.react(${msg.id}, '${e}')">${e}</span>`
                ).join('')}
            </div>
        </div>` : '';

    li.innerHTML = `${content} ${reactionsHTML} <span class="timestamp">${time} ${read}</span> ${menu}`;
    DOM.messages.appendChild(li);
    if(scroll) scrollToBottom();
}

function sendMessage() {
    const txt = DOM.input.value.trim();
    if(!txt || !activeChatRecipientId) return;
    socket.emit('send_message', {
        recipient_id: activeChatRecipientId,
        text: txt,
        media_type: isGifUrl(txt)?'gif':'text',
        media_url: isGifUrl(txt)?txt:null,
        reply_to_id: replyToMessage?replyToMessage.id:null
    });
    DOM.input.value = ''; hideReplyIndicator();
}

// === HELPERS ===
function handleTyping() {
    if(!activeChatRecipientId) return;
    if(!isTyping) { isTyping=true; socket.emit('typing_start', {partner_id: activeChatRecipientId}); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { isTyping=false; socket.emit('typing_stop', {partner_id: activeChatRecipientId}); }, 2000);
}

function handleFileSelect(e) {
    const f = e.target.files[0]; if(!f || !activeChatRecipientId) return;
    const fd = new FormData(); fd.append('file', f); fd.append('recipient_id', activeChatRecipientId);
    fetch('/upload', {method:'POST', body:fd}).then(r=>r.json()).catch(console.error);
    e.target.value = null;
}

function createChatHeaderAvatar(user) {
    const old = document.getElementById('chat-header-avatar'); if(old) old.remove();
    const div = document.createElement('div'); div.id = 'chat-header-avatar'; div.className = 'chat-header-avatar';
    div.innerHTML = user.avatar_url ? `<img src="${user.avatar_url}">` : `<div class="chat-header-avatar-placeholder">${(user.username||"?")[0].toUpperCase()}</div>`;
    div.onclick = () => window.location.href = `/user/${user.id}`;
    DOM.titleWrapper.before(div);
}

function showReplyIndicator(msg) {
    if(DOM.replyIndicator) {
        DOM.replyIndicator.className = 'visible';
        DOM.replyAuthor.innerText = msg.sender_display_name || "User";
        DOM.replyText.innerText = msg.media_type === 'text' ? msg.text : `[${msg.media_type}]`;
    }
}
function hideReplyIndicator() { 
    if(DOM.replyIndicator) DOM.replyIndicator.className = ''; 
    replyToMessage = null; 
}

function debounce(func, wait) { let t; return function(...a) { clearTimeout(t); t = setTimeout(() => func.apply(this, a), wait); }; }
function formatUTCToLocal(iso) { if(!iso) return ""; return new Date(iso).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function formatLastSeen(iso) { if(!iso) return ""; const d = new Date(iso); return d.toDateString()===new Date().toDateString() ? `був сьогодні о ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : `був ${d.toLocaleDateString()}`; }
function isGifUrl(t) { return t.startsWith('http') && (t.includes('giphy') || t.includes('tenor') || t.endsWith('.gif')); }
function scrollToBottom() { DOM.messages.scrollTop = DOM.messages.scrollHeight; }
function findMsg(id) { for(let uid in chatHistories) { const m = chatHistories[uid].find(x => x.id === id); if(m) return m; } return null; }

// === GLOBAL ===
window.reply = (id) => { const m = findMsg(id); if(m) { replyToMessage = m; showReplyIndicator(m); DOM.input.focus(); } };
window.toggleReactions = (id, e) => {
    if(e) e.stopPropagation();
    document.querySelectorAll('.emoji-picker').forEach(el => el.style.display = 'none');
    const el = document.getElementById(`emoji-${id}`);
    if(el) el.style.display = el.style.display==='block' ? 'none' : 'block';
};
window.react = (id, e) => {
    socket.emit('add_reaction', {message_id: id, emoji: e});
    const el = document.getElementById(`emoji-${id}`);
    if(el) el.style.display = 'none';
};
window.del = (id) => { if(confirm('Видалити?')) socket.emit('delete_message', {message_id: id}); };

// === GIF ===
let currentGifTab = 'trending';

function openGifModal() { 
    DOM.gifModal.classList.add('modal-visible'); 
    // Завжди оновлюємо контент при відкритті
    if(currentGifTab==='trending') loadTrendingGifs(); 
    if(currentGifTab==='my') socket.emit('load_my_gifs');
}
function closeGifModal() { DOM.gifModal.classList.remove('modal-visible'); }

function switchGifTab(tab) {
    currentGifTab = tab;
    document.querySelectorAll('.gif-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.gif-tab[data-tab="${tab}"]`).classList.add('active');
    DOM.gifSearchInput.parentElement.style.display = tab === 'search' ? 'flex' : 'none';
    
    DOM.gifLibrary.innerHTML = '';
    if(tab==='my') socket.emit('load_my_gifs');
    if(tab==='trending') loadTrendingGifs();
}
function renderGifs(data) {
    DOM.gifLibrary.innerHTML = '';
    data.forEach(item => {
        const img = document.createElement('img');
        img.src = item.images.fixed_height_small.url;
        img.className = 'gif-item';
        DOM.gifLibrary.appendChild(img);
    });
}
function loadTrendingGifs() {
    DOM.gifLibrary.innerHTML = '<div class="gif-loading">Завантаження...</div>';
    fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20`)
    .then(r=>r.json()).then(d=>renderGifs(d.data))
    .catch(()=>DOM.gifLibrary.innerHTML='<div class="gif-loading">Помилка (API Key?)</div>');
}
function searchGifs() {
    const q = DOM.gifSearchInput.value; if(!q) return;
    DOM.gifLibrary.innerHTML = '<div class="gif-loading">Пошук...</div>';
    fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${q}&limit=20`)
    .then(r=>r.json()).then(d=>renderGifs(d.data))
    .catch(()=>DOM.gifLibrary.innerHTML='<div class="gif-loading">Помилка</div>');
}
function handleGifSelect(e) {
    if(e.target.tagName === 'IMG') {
        socket.emit('send_message', {recipient_id: activeChatRecipientId, text: null, media_type: 'gif', media_url: e.target.src});
        closeGifModal();
    }
}

document.addEventListener('DOMContentLoaded', init);