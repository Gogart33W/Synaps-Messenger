// ======================================================
// === ГЛОБАЛЬНІ ЗМІННІ
// ======================================================
let activeChatRecipientId = null;
let isTyping = false;
let typingTimeout = null;
let replyToMessage = null;

// Кеш даних
const allUsers = {}; // id -> user object
const chatHistories = {}; // id -> array of messages
const unreadCounts = {}; 
const online_users = new Set();

// Socket
let socket;

// Об'єкт для елементів DOM
const DOM = {}; 

// ======================================================
// === ІНІЦІАЛІЗАЦІЯ
// ======================================================
function init() {
    console.log("Chat initialized");
    socket = io();
    
    // Отримуємо ID поточного юзера
    const wrapper = document.getElementById('content-wrapper');
    if (wrapper) {
        window.currentUserId = parseInt(wrapper.dataset.currentUserId, 10);
    }

    // Кешуємо елементи DOM
    DOM.userList = document.getElementById('user-list');
    DOM.searchInput = document.getElementById('user-search-input');
    DOM.messages = document.getElementById('messages');
    DOM.input = document.getElementById('message_input');
    DOM.sendBtn = document.getElementById('send_button');
    DOM.chatTitle = document.getElementById('chat-with-title');
    DOM.chatStatus = document.getElementById('chat-with-status');
    DOM.titleWrapper = document.getElementById('chat-title-wrapper');
    DOM.backBtn = document.getElementById('back-to-chats-btn');

    // GIF елементи
    DOM.gifButton = document.getElementById('gif_button');
    DOM.gifModal = document.getElementById('gif-modal');
    DOM.gifLibrary = document.getElementById('gif-library');
    DOM.gifSearchInput = document.getElementById('gif-search-input');
    DOM.fileInput = document.getElementById('file_input');

    // === ОБРОБНИКИ ПОДІЙ ===
    if(DOM.userList) DOM.userList.addEventListener('click', handleUserClick);
    if(DOM.searchInput) DOM.searchInput.addEventListener('input', debounce(handleSearch, 300));
    if(DOM.sendBtn) DOM.sendBtn.addEventListener('click', sendMessage);
    
    if(DOM.input) {
        DOM.input.addEventListener('keypress', (e) => {
            if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        DOM.input.addEventListener('input', handleTyping);
    }

    // GIF & File handlers
    if(DOM.fileInput) DOM.fileInput.addEventListener('change', handleFileSelect);
    if(DOM.gifButton) DOM.gifButton.addEventListener('click', () => DOM.gifModal.classList.add('modal-visible'));
    document.getElementById('gif-close-button')?.addEventListener('click', () => DOM.gifModal.classList.remove('modal-visible'));
    DOM.gifModal?.addEventListener('click', (e) => { if(e.target === DOM.gifModal) DOM.gifModal.classList.remove('modal-visible'); });
    DOM.gifLibrary?.addEventListener('click', handleGifSelect);
    document.getElementById('gif-search-button')?.addEventListener('click', searchGifs);
    document.querySelectorAll('.gif-tab').forEach(t => t.addEventListener('click', (e) => switchGifTab(e.target.dataset.tab)));

    if(DOM.backBtn) {
        DOM.backBtn.addEventListener('click', () => {
            document.getElementById('content-wrapper').classList.remove('chat-view-active');
            activeChatRecipientId = null;
        });
    }

    setupSocketHandlers();
}

// ======================================================
// === ЛОГІКА КЛІКУ ПО КОРИСТУВАЧУ (ВИПРАВЛЕНА)
// ======================================================
function handleUserClick(e) {
    const li = e.target.closest('.user-item');
    if (!li) return;
    
    const uid = parseInt(li.dataset.id);
    // Беремо ім'я прямо з атрибута (надійніше)
    const username = li.dataset.username || "Користувач"; 
    
    console.log("Opening chat with:", uid, username);

    activeChatRecipientId = uid;
    
    // 1. Оновлюємо UI списку
    document.querySelectorAll('.user-item').forEach(i => i.classList.remove('active'));
    li.classList.add('active');
    document.getElementById('content-wrapper').classList.add('chat-view-active');
    
    // 2. Оновлюємо заголовок чату (БЕЗПЕЧНО)
    if (DOM.chatTitle) DOM.chatTitle.innerText = username;
    
    // 3. Оновлюємо статус і аватар в хедері
    const userObj = allUsers[uid]; // Може бути undefined, це ок
    const isOnline = online_users.has(uid);
    
    if (DOM.chatStatus) {
        DOM.chatStatus.innerText = isOnline ? 'Онлайн' : (userObj ? formatLastSeen(userObj.last_seen) : '');
        DOM.chatStatus.className = `chat-status-subtitle ${isOnline ? 'online' : ''}`;
    }
    
    createChatHeaderAvatar(userObj || { username: username, id: uid });

    // 4. Активуємо інпут
    DOM.input.disabled = false;
    DOM.sendBtn.disabled = false;
    DOM.input.placeholder = `Напишіть ${username}...`;
    DOM.input.focus();

    // 5. Скидаємо лічильник непрочитаних
    unreadCounts[uid] = 0;
    const badge = li.querySelector('.unread-badge');
    if(badge) badge.style.display = 'none';
    socket.emit('mark_as_read', {chat_partner_id: uid});

    // 6. Завантажуємо історію
    if (chatHistories[uid]) {
        renderMessages(chatHistories[uid]);
    } else {
        DOM.messages.innerHTML = '<li class="status">Завантаження історії...</li>';
        socket.emit('load_history', {partner_id: uid});
    }
    
    // Якщо це був пошук - очищаємо його
    if(DOM.searchInput.value.trim().length > 0) {
        DOM.searchInput.value = '';
        socket.emit('users_list_request');
    }
}

// ======================================================
// === ЛОГІКА ПОШУКУ ТА СПИСКУ
// ======================================================
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
    .then(data => {
        renderUserList(data.users, 'search');
    })
    .catch(err => {
        console.error(err);
        DOM.userList.innerHTML = '<li class="status">Помилка пошуку</li>';
    });
}

function renderUserList(users, type='chats') {
    DOM.userList.innerHTML = '';
    
    if (users.length === 0) {
        const msg = type === 'search' ? 'Нікого не знайдено 😢' : 'У вас ще немає чатів. Знайдіть когось! 👋';
        DOM.userList.innerHTML = `<li class="status">${msg}</li>`;
        return;
    }
    
    users.forEach(u => {
        allUsers[u.id] = u; // Зберігаємо в кеш
        
        const li = document.createElement('li');
        li.className = `user-item ${online_users.has(u.id) ? 'online' : ''}`;
        if (u.id === activeChatRecipientId) li.classList.add('active');
        
        // ВАЖЛИВО: Зберігаємо дані в атрибутах
        li.dataset.id = u.id;
        li.dataset.username = u.display_name || u.username;
        
        const avatar = u.avatar_url 
            ? `<img src="${u.avatar_url}" class="user-avatar-img">` 
            : `<div class="user-avatar-placeholder">${u.username[0].toUpperCase()}</div>`;
            
        let subText = '';
        if (type === 'chats') {
            subText = `<span class="last-message">${u.last_message_text || ''}</span>`;
        } else {
            subText = `<span class="last-seen">${u.username}</span>`;
        }
        
        const count = unreadCounts[u.id] || 0;

        li.innerHTML = `
            <div class="avatar-wrapper">
                <div class="user-avatar-container">${avatar}</div>
                <div class="status-dot"></div>
            </div>
            <div class="user-info">
                <span class="username">${u.display_name || u.username}</span>
                ${subText}
            </div>
            <span class="unread-badge" style="display:${count > 0 ? 'block' : 'none'}">${count}</span>
        `;
        DOM.userList.appendChild(li);
    });
}

// ======================================================
// === СОКЕТИ
// ======================================================
function setupSocketHandlers() {
    socket.on('connect', () => console.log('Socket Connected'));
    
    socket.on('users_list', data => {
        online_users.clear();
        data.online_ids.forEach(id => online_users.add(id));
        
        // Оновлюємо список, ТІЛЬКИ якщо ми не шукаємо зараз
        if (DOM.searchInput.value.trim().length === 0) {
            renderUserList(data.users, 'chats');
        }
    });
    
    socket.on('new_message', data => {
        const partnerId = (data.sender_id === window.currentUserId) ? data.recipient_id : data.sender_id;
        
        // 1. Додаємо в історію
        if(!chatHistories[partnerId]) chatHistories[partnerId] = [];
        chatHistories[partnerId].push(data);
        
        // 2. Якщо чат відкритий - показуємо
        if(partnerId === activeChatRecipientId) {
            if (DOM.messages.querySelector('.status')) DOM.messages.innerHTML = '';
            appendMessage(data, true);
            if(data.sender_id !== window.currentUserId) {
                socket.emit('mark_as_read', {chat_partner_id: partnerId});
            }
        } 
        // 3. Якщо закритий - збільшуємо лічильник
        else if (data.sender_id !== window.currentUserId) {
            unreadCounts[partnerId] = (unreadCounts[partnerId] || 0) + 1;
            // Оновлюємо тільки бейдж, якщо елемент є в DOM
            const li = document.querySelector(`.user-item[data-id="${partnerId}"]`);
            if(li) {
                const badge = li.querySelector('.unread-badge');
                badge.innerText = unreadCounts[partnerId];
                badge.style.display = 'block';
                // Оновлюємо текст останнього повідомлення
                const msgTxt = data.media_type === 'text' ? data.text : `[${data.media_type}]`;
                li.querySelector('.last-message').innerText = msgTxt;
            }
        }
    });
    
    socket.on('history_loaded', data => {
        chatHistories[data.partner_id] = data.history;
        if(activeChatRecipientId === data.partner_id) {
            renderMessages(data.history);
        }
    });

    socket.on('user_status_change', data => {
        if(data.status === 'online') online_users.add(data.user_id);
        else online_users.delete(data.user_id);
        
        if(activeChatRecipientId === data.user_id && DOM.chatStatus) {
            DOM.chatStatus.innerText = (data.status === 'online') ? 'Онлайн' : formatLastSeen(data.last_seen);
            DOM.chatStatus.className = `chat-status-subtitle ${data.status === 'online' ? 'online' : ''}`;
        }
        
        const li = document.querySelector(`.user-item[data-id="${data.user_id}"]`);
        if(li) {
            if(data.status === 'online') li.classList.add('online');
            else li.classList.remove('online');
        }
    });
    
    socket.on('reaction_updated', data => {
        // Оновлюємо кеш
        for(let uid in chatHistories) {
             let m = chatHistories[uid].find(x => x.id === data.message_id);
             if(m) { m.reactions = data.reactions; break; }
        }
        // Оновлюємо UI якщо видно
        if(activeChatRecipientId) {
             const li = document.querySelector(`li[data-message-id="${data.message_id}"]`);
             if(li) {
                 // Перерендерюємо повідомлення або просто оновлюємо реакції
                 // Для простоти можна перезавантажити історію з кешу, але це мерехтить
                 // Тому просто видаляємо старі і додаємо нові
                 const oldR = li.querySelector('.message-reactions');
                 if(oldR) oldR.remove();
                 
                 if(Object.keys(data.reactions).length > 0) {
                     let html = '<div class="message-reactions">';
                     for(let [emoji, users] of Object.entries(data.reactions)) {
                         const my = users.some(u => u.user_id === window.currentUserId);
                         html += `<span class="reaction-item ${my?'my-reaction':''}" onclick="window.react(${data.message_id}, '${emoji}')">
                            <span class="reaction-emoji">${emoji}</span><span class="reaction-count">${users.length}</span>
                         </span>`;
                     }
                     html += '</div>';
                     li.querySelector('.timestamp').insertAdjacentHTML('beforebegin', html);
                 }
             }
        }
    });
    
    socket.on('message_deleted', data => {
         // Оновлюємо кеш
         const pid = (data.sender_id === window.currentUserId) ? data.recipient_id : data.sender_id;
         if(chatHistories[pid]) {
             const m = chatHistories[pid].find(x => x.id === data.id);
             if(m) m.is_deleted = true;
         }
         // Оновлюємо UI
         if(pid === activeChatRecipientId) {
             const li = document.querySelector(`li[data-message-id="${data.id}"]`);
             if(li) {
                 li.classList.add('deleted');
                 li.innerHTML = `<span>🚫 Повідомлення видалено</span><span class="timestamp">${formatUTCToLocal(data.timestamp)}</span>`;
             }
         }
    });
}

// ======================================================
// === РЕНДЕР ПОВІДОМЛЕНЬ
// ======================================================
function renderMessages(history) {
    DOM.messages.innerHTML = '';
    if (!history || history.length === 0) {
        DOM.messages.innerHTML = '<li class="status">Тут поки що пусто. Напишіть першим!</li>';
        return;
    }
    history.forEach(msg => appendMessage(msg, false));
    scrollToBottom();
}

function appendMessage(msg, scroll=true) {
    const li = document.createElement('li');
    li.className = msg.sender_id === window.currentUserId ? 'my-message' : '';
    if(msg.is_deleted) li.classList.add('deleted');
    li.dataset.messageId = msg.id;
    
    let content = '';
    if (msg.is_deleted) {
        content = '🚫 Повідомлення видалено';
    } else {
        // Reply
        if (msg.reply_to) {
            const rTxt = msg.reply_to.is_deleted ? 'Повідомлення видалено' : (msg.reply_to.text || '[Медіа]');
            content += `<div class="message-reply-container">
                <div class="message-reply-author">${msg.reply_to.sender_name || 'Користувач'}</div>
                <div class="message-reply-text">${rTxt}</div>
            </div>`;
        }
        // Main content
        if (msg.media_type === 'image' || msg.media_type === 'gif') {
            content += `<img src="${msg.media_url || msg.text}" class="chat-image" onclick="window.open(this.src)">`;
        } else if (msg.media_type === 'video') {
            content += `<video src="${msg.media_url}" class="chat-video" controls></video>`;
        } else {
            content += `<div>${(msg.text || "").replace(/\n/g, '<br>')}</div>`;
        }
    }

    // Reactions
    let reactionsHTML = '';
    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
        reactionsHTML = '<div class="message-reactions">';
        for(let [emoji, users] of Object.entries(msg.reactions)) {
             const my = users.some(u => u.user_id === window.currentUserId);
             reactionsHTML += `<span class="reaction-item ${my?'my-reaction':''}" onclick="window.react(${msg.id}, '${emoji}')">
                <span class="reaction-emoji">${emoji}</span><span class="reaction-count">${users.length}</span>
             </span>`;
        }
        reactionsHTML += '</div>';
    }
    
    // Menu (only if not deleted)
    const menu = !msg.is_deleted ? `
        <div class="message-context-menu">
            <button class="context-menu-btn" onclick="window.reply(${msg.id})">↩️</button>
            <button class="context-menu-btn" onclick="window.toggleReactions(${msg.id})">😀</button>
            ${msg.sender_id === window.currentUserId ? `<button class="context-menu-btn delete-btn" onclick="window.del(${msg.id})">🗑️</button>` : ''}
        </div>
        <div class="emoji-picker" id="emoji-${msg.id}">
            <div class="emoji-picker-grid">
                ${['❤️','👍','😂','😮','😢','😡','🔥','🎉'].map(e => 
                    `<span class="emoji-picker-item" onclick="window.react(${msg.id}, '${e}')">${e}</span>`
                ).join('')}
            </div>
        </div>
    ` : '';

    const time = formatUTCToLocal(msg.timestamp);
    const read = (msg.sender_id === window.currentUserId) ? 
        `<span class="read-status ${msg.is_read ? 'read' : ''}">${msg.is_read ? '✓✓' : '✓'}</span>` : '';

    li.innerHTML = `${content} ${reactionsHTML} <span class="timestamp">${time} ${read}</span> ${menu}`;
    
    DOM.messages.appendChild(li);
    if(scroll) scrollToBottom();
}

// ======================================================
// === ДІЇ (SEND, TYPING, ETC)
// ======================================================
function sendMessage() {
    const txt = DOM.input.value.trim();
    if(!txt || !activeChatRecipientId) return;
    
    socket.emit('send_message', {
        recipient_id: activeChatRecipientId,
        text: txt,
        media_type: isGifUrl(txt) ? 'gif' : 'text',
        media_url: isGifUrl(txt) ? txt : null,
        reply_to_id: replyToMessage ? replyToMessage.id : null
    });
    
    DOM.input.value = '';
    hideReplyIndicator();
}

function handleTyping() {
    if (!activeChatRecipientId) return;
    if (!isTyping) {
        isTyping = true;
        socket.emit('typing_start', { partner_id: activeChatRecipientId });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        socket.emit('typing_stop', { partner_id: activeChatRecipientId });
    }, 2000);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if(!file || !activeChatRecipientId) return;
    
    // Тут можна додати лоадер
    const formData = new FormData();
    formData.append('file', file);
    formData.append('recipient_id', activeChatRecipientId);
    
    fetch('/upload', {method: 'POST', body: formData})
        .then(r => r.json())
        .then(d => {
            if(!d.success) alert('Upload failed: ' + d.error);
        })
        .catch(e => console.error(e));
        
    e.target.value = null;
}

// ======================================================
// === ХЕЛПЕРИ
// ======================================================
function createChatHeaderAvatar(user) {
    const old = document.getElementById('chat-header-avatar');
    if(old) old.remove();
    if(!user) return;
    
    const div = document.createElement('div');
    div.id = 'chat-header-avatar';
    div.className = 'chat-header-avatar';
    
    if (user.avatar_url) {
        div.innerHTML = `<img src="${user.avatar_url}">`;
    } else {
        const l = (user.username || "?")[0].toUpperCase();
        div.innerHTML = `<div class="chat-header-avatar-placeholder">${l}</div>`;
    }
    
    div.onclick = () => window.open(`/user/${user.id}`, '_blank');
    DOM.titleWrapper.before(div);
}

function showReplyIndicator(msg) {
    const ind = document.getElementById('reply-indicator');
    ind.className = 'visible';
    const t = msg.media_type === 'text' ? msg.text : `[${msg.media_type}]`;
    document.getElementById('reply-indicator-author').innerText = msg.sender_display_name || "User";
    document.getElementById('reply-indicator-text').innerText = t;
    document.getElementById('reply-cancel-btn').onclick = hideReplyIndicator;
}

function hideReplyIndicator() {
    document.getElementById('reply-indicator').className = '';
    replyToMessage = null;
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function formatUTCToLocal(iso) {
    if(!iso) return "";
    return new Date(iso).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

function formatLastSeen(iso) {
    if(!iso) return "";
    const d = new Date(iso);
    if(d.toDateString() === new Date().toDateString()) 
        return `був сьогодні о ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    return `був ${d.toLocaleDateString()}`;
}

function isGifUrl(t) { return t.startsWith('http') && (t.includes('giphy') || t.includes('tenor') || t.endsWith('.gif')); }
function scrollToBottom() { DOM.messages.scrollTop = DOM.messages.scrollHeight; }

// Глобальні функції для HTML onlclick
window.reply = (id) => {
    const msg = findMsg(id);
    if(msg) { replyToMessage = msg; showReplyIndicator(msg); DOM.input.focus(); }
};
window.toggleReactions = (id) => {
    document.querySelectorAll('.emoji-picker').forEach(el => el.style.display = 'none');
    const p = document.getElementById(`emoji-${id}`);
    if(p) p.style.display = (p.style.display === 'block') ? 'none' : 'block';
};
window.react = (id, e) => {
    socket.emit('add_reaction', {message_id: id, emoji: e});
    window.toggleReactions(id);
};
window.del = (id) => { if(confirm('Видалити?')) socket.emit('delete_message', {message_id: id}); };
function findMsg(id) {
    for(let uid in chatHistories) {
        const m = chatHistories[uid].find(x => x.id === id);
        if(m) return m;
    }
    return null;
}

// === GIF HELPERS ===
function searchGifs() { /* ... implementation same as before ... */ }
function handleGifSelect(e) { 
    if(e.target.tagName === 'IMG') {
        const url = e.target.src;
        socket.emit('send_message', {recipient_id: activeChatRecipientId, text: null, media_type: 'gif', media_url: url});
        DOM.gifModal.classList.remove('modal-visible');
    }
}
function switchGifTab(tab) { /* ... */ }

// Start
document.addEventListener('DOMContentLoaded', init);