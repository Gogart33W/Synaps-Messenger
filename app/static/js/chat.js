// ======================================================
// === ГЛОБАЛЬНІ ЗМІННІ
// ======================================================
let activeChatRecipientId = null;
let activeUserItem = null;
let replyToMessage = null;
let isTyping = false;
let typingTimeout = null;

// Кеш даних (щоб не смикати сервер зайвий раз)
const allUsers = {}; 
const chatHistories = {};
const unreadCounts = {};
const online_users = new Set();

let socket;

// Об'єкт для всіх елементів DOM (щоб не шукати їх щоразу)
const DOM = {}; 

// ======================================================
// === 1. ІНІЦІАЛІЗАЦІЯ (START)
// ======================================================
function init() {
    console.log("Chat initialized...");
    socket = io();
    
    // Отримуємо ID поточного юзера з HTML
    const wrapper = document.getElementById('content-wrapper');
    if (wrapper) {
        window.currentUserId = parseInt(wrapper.dataset.currentUserId, 10);
    }

    // Знаходимо всі елементи
    DOM.userList = document.getElementById('user-list');
    DOM.searchInput = document.getElementById('user-search-input');
    DOM.messages = document.getElementById('messages');
    DOM.input = document.getElementById('message_input');
    DOM.sendBtn = document.getElementById('send_button');
    DOM.chatTitle = document.getElementById('chat-with-title');
    DOM.chatStatus = document.getElementById('chat-with-status');
    DOM.titleWrapper = document.getElementById('chat-title-wrapper');
    DOM.backBtn = document.getElementById('back-to-chats-btn');
    
    // Елементи для файлів та GIF
    DOM.fileInput = document.getElementById('file_input');
    DOM.gifButton = document.getElementById('gif_button');
    DOM.gifModal = document.getElementById('gif-modal');
    DOM.gifLibrary = document.getElementById('gif-library');
    DOM.gifSearchInput = document.getElementById('gif-search-input');
    DOM.gifSearchButton = document.getElementById('gif-search-button');
    DOM.gifCloseButton = document.getElementById('gif-close-button');

    // === ПРИВ'ЯЗКА ПОДІЙ (Event Listeners) ===
    
    // Кліки по списку юзерів
    if(DOM.userList) DOM.userList.addEventListener('click', handleUserClick);
    
    // Пошук юзерів (із затримкою, щоб не спамити сервер)
    if(DOM.searchInput) DOM.searchInput.addEventListener('input', debounce(handleSearch, 300));
    
    // Відправка повідомлень
    if(DOM.sendBtn) DOM.sendBtn.addEventListener('click', sendMessage);
    if(DOM.input) {
        DOM.input.addEventListener('keypress', (e) => {
            if(e.key === 'Enter' && !e.shiftKey) { 
                e.preventDefault(); 
                sendMessage(); 
            }
        });
        DOM.input.addEventListener('input', handleTyping);
    }

    // Файли
    if(DOM.fileInput) DOM.fileInput.addEventListener('change', handleFileSelect);

    // GIF Логіка
    if(DOM.gifButton) DOM.gifButton.addEventListener('click', openGifModal);
    if(DOM.gifCloseButton) DOM.gifCloseButton.addEventListener('click', closeGifModal);
    if(DOM.gifModal) DOM.gifModal.addEventListener('click', (e) => { 
        if(e.target === DOM.gifModal) closeGifModal(); 
    });
    if(DOM.gifLibrary) DOM.gifLibrary.addEventListener('click', handleGifSelect);
    if(DOM.gifSearchButton) DOM.gifSearchButton.addEventListener('click', searchGifs);
    
    // Перемикання вкладок GIF
    document.querySelectorAll('.gif-tab').forEach(tab => {
        tab.addEventListener('click', (e) => switchGifTab(e.target.dataset.tab));
    });

    // Кнопка "Назад" (для мобільних)
    if(DOM.backBtn) {
        DOM.backBtn.addEventListener('click', () => {
            document.getElementById('content-wrapper').classList.remove('chat-view-active');
            activeChatRecipientId = null;
        });
    }

    // Запускаємо сокети
    setupSocketHandlers();
}

// ======================================================
// === 2. ЛОГІКА КЛІКУ ПО ЧАТУ (ВИПРАВЛЕНО)
// ======================================================
function handleUserClick(e) {
    const li = e.target.closest('.user-item');
    if (!li) return;
    
    const uid = parseInt(li.dataset.id);
    const username = li.dataset.username || "Користувач"; 
    
    console.log("Opening chat with:", uid, username);

    activeChatRecipientId = uid;
    
    // 1. Візуально виділяємо активний чат
    document.querySelectorAll('.user-item').forEach(i => i.classList.remove('active'));
    li.classList.add('active');
    document.getElementById('content-wrapper').classList.add('chat-view-active');
    
    // 2. Миттєво оновлюємо заголовок (щоб юзер не чекав)
    if (DOM.chatTitle) DOM.chatTitle.innerText = username;
    
    // 3. Оновлюємо статус і аватар
    const userObj = allUsers[uid];
    const isOnline = online_users.has(uid);
    
    if (DOM.chatStatus) {
        DOM.chatStatus.innerText = isOnline ? 'Онлайн' : (userObj ? formatLastSeen(userObj.last_seen) : '');
        DOM.chatStatus.className = `chat-status-subtitle ${isOnline ? 'online' : ''}`;
    }
    
    createChatHeaderAvatar(userObj || { username: username, id: uid });

    // 4. Вмикаємо поле вводу і кнопки
    DOM.input.disabled = false;
    DOM.sendBtn.disabled = false;
    if(DOM.gifButton) DOM.gifButton.disabled = false; // Вмикаємо кнопку GIF
    DOM.input.placeholder = `Напишіть ${username}...`;
    DOM.input.focus();

    // 5. Прибираємо бейдж "непрочитані"
    unreadCounts[uid] = 0;
    const badge = li.querySelector('.unread-badge');
    if(badge) badge.style.display = 'none';
    socket.emit('mark_as_read', {chat_partner_id: uid});

    // 6. Завантажуємо повідомлення (з кешу або сервера)
    if (chatHistories[uid]) {
        renderMessages(chatHistories[uid]);
    } else {
        DOM.messages.innerHTML = '<li class="status">Завантаження історії...</li>';
        socket.emit('load_history', {partner_id: uid});
    }
    
    // Якщо це був пошук, очищаємо поле пошуку
    if(DOM.searchInput.value.trim().length > 0) {
        DOM.searchInput.value = '';
        socket.emit('users_list_request');
    }
}

// ======================================================
// === 3. ПОШУК ТА СПИСОК ЮЗЕРІВ
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
        allUsers[u.id] = u; // Зберігаємо юзера
        
        const li = document.createElement('li');
        li.className = `user-item ${online_users.has(u.id) ? 'online' : ''}`;
        if (u.id === activeChatRecipientId) li.classList.add('active');
        
        // Зберігаємо дані в HTML для швидкого доступу
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
// === 4. SOCKET.IO (КОМУНІКАЦІЯ)
// ======================================================
function setupSocketHandlers() {
    socket.on('connect', () => console.log('Socket Connected'));
    
    socket.on('users_list', data => {
        online_users.clear();
        data.online_ids.forEach(id => online_users.add(id));
        // Оновлюємо список тільки якщо не йде пошук
        if (DOM.searchInput.value.trim().length === 0) {
            renderUserList(data.users, 'chats');
        }
    });
    
    socket.on('new_message', data => {
        const partnerId = (data.sender_id === window.currentUserId) ? data.recipient_id : data.sender_id;
        
        if(!chatHistories[partnerId]) chatHistories[partnerId] = [];
        chatHistories[partnerId].push(data);
        
        if(partnerId === activeChatRecipientId) {
            // Якщо чат відкритий - показуємо повідомлення
            if (DOM.messages.querySelector('.status')) DOM.messages.innerHTML = '';
            appendMessage(data, true);
            if(data.sender_id !== window.currentUserId) {
                socket.emit('mark_as_read', {chat_partner_id: partnerId});
            }
        } else if (data.sender_id !== window.currentUserId) {
            // Якщо чат закритий - оновлюємо лічильник і прев'ю
            unreadCounts[partnerId] = (unreadCounts[partnerId] || 0) + 1;
            const li = document.querySelector(`.user-item[data-id="${partnerId}"]`);
            if(li) {
                li.querySelector('.unread-badge').innerText = unreadCounts[partnerId];
                li.querySelector('.unread-badge').style.display = 'block';
                li.querySelector('.last-message').innerText = data.media_type === 'text' ? data.text : `[${data.media_type}]`;
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
        // Оновлюємо в кеші
        for(let uid in chatHistories) {
             let m = chatHistories[uid].find(x => x.id === data.message_id);
             if(m) { m.reactions = data.reactions; break; }
        }
        // Оновлюємо на екрані, якщо видно
        if(activeChatRecipientId) {
             const li = document.querySelector(`li[data-message-id="${data.message_id}"]`);
             if(li) {
                 // Видаляємо старі реакції
                 const oldR = li.querySelector('.message-reactions');
                 if(oldR) oldR.remove();
                 
                 // Малюємо нові
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

// ======================================================
// === 5. РЕНДЕР ПОВІДОМЛЕНЬ
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
            content += `
                <div class="message-reply-container">
                    <div class="message-reply-author">${msg.reply_to.sender_name || 'Користувач'}</div>
                    <div class="message-reply-text">${rTxt}</div>
                </div>`;
        }
        // Forward
        if (msg.forwarded_from) {
            content += `<div class="message-forwarded">📤 Переслано від ${msg.forwarded_from.sender_name}</div>`;
        }
        // Медіа контент
        if (['image','gif'].includes(msg.media_type)) {
            content += `<img src="${msg.media_url || msg.text}" class="chat-image" onclick="window.open(this.src)">`;
        } else if (msg.media_type === 'video') {
            content += `<video src="${msg.media_url}" class="chat-video" controls></video>`;
        } else {
            content += `<div>${(msg.text || "").replace(/\n/g, '<br>')}</div>`;
        }
    }

    // Реакції
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
    
    // Меню і Статус
    const read = (msg.sender_id === window.currentUserId) ? 
        `<span class="read-status ${msg.is_read ? 'read' : ''}">${msg.is_read ? '✓✓' : '✓'}</span>` : '';

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

    li.innerHTML = `
        ${content} 
        ${reactionsHTML} 
        <span class="timestamp">${formatUTCToLocal(msg.timestamp)} ${read}</span> 
        ${menu}
    `;
    
    DOM.messages.appendChild(li);
    if(scroll) scrollToBottom();
}

// ======================================================
// === 6. ВІДПРАВКА ТА ІНШІ ДІЇ
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
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('recipient_id', activeChatRecipientId);
    
    // Відправляємо файл
    fetch('/upload', {method: 'POST', body: formData})
        .then(r => r.json())
        .then(d => {
            if(!d.success) alert('Помилка: ' + d.error);
        })
        .catch(e => console.error(e));
        
    e.target.value = null;
}

// ======================================================
// === 7. ДОПОМІЖНІ ФУНКЦІЇ (HELPERS)
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
    document.getElementById('reply-indicator').className = 'visible';
    document.getElementById('reply-indicator-author').innerText = msg.sender_display_name || "User";
    document.getElementById('reply-indicator-text').innerText = msg.media_type === 'text' ? msg.text : `[${msg.media_type}]`;
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

function isGifUrl(t) {
    return t.startsWith('http') && (t.includes('giphy') || t.includes('tenor') || t.endsWith('.gif'));
}

function scrollToBottom() {
    DOM.messages.scrollTop = DOM.messages.scrollHeight;
}

function findMsg(id) {
    for(let uid in chatHistories) {
        const m = chatHistories[uid].find(x => x.id === id);
        if(m) return m;
    }
    return null;
}

// ======================================================
// === 8. ГЛОБАЛЬНІ ФУНКЦІЇ (ДЛЯ HTML ONCLICK)
// ======================================================

window.reply = (id) => {
    const msg = findMsg(id);
    if(msg) {
        replyToMessage = msg;
        showReplyIndicator(msg);
        DOM.input.focus();
    }
};

window.toggleReactions = (id) => {
    document.querySelectorAll('.emoji-picker').forEach(el => el.style.display = 'none');
    const p = document.getElementById(`emoji-${id}`);
    if(p) p.style.display = (p.style.display === 'block') ? 'none' : 'block';
};

window.react = (id, e) => {
    socket.emit('add_reaction', {message_id: id, emoji: e});
    // Примусово закриваємо меню після кліку
    const p = document.getElementById(`emoji-${id}`);
    if(p) p.style.display = 'none';
};

window.del = (id) => {
    if(confirm('Видалити повідомлення?')) {
        socket.emit('delete_message', {message_id: id});
    }
};

// ======================================================
// === 9. GIF ЛОГІКА
// ======================================================

function openGifModal() {
    DOM.gifModal.classList.add('modal-visible');
    if(currentGifTab === 'trending') loadTrendingGifs();
}

function closeGifModal() {
    DOM.gifModal.classList.remove('modal-visible');
}

function switchGifTab(tab) {
    currentGifTab = tab;
    document.querySelectorAll('.gif-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.gif-tab[data-tab="${tab}"]`).classList.add('active');
    
    DOM.gifSearchInput.parentElement.style.display = tab === 'search' ? 'flex' : 'none';
    
    DOM.gifLibrary.innerHTML = '';
    if(tab === 'trending') loadTrendingGifs();
    if(tab === 'my') socket.emit('load_my_gifs');
}

function loadTrendingGifs() {
    // Тут має бути API запит до GIPHY.
    // Оскільки API ключа немає, ставимо заглушку або просимо юзера ввести
    DOM.gifLibrary.innerHTML = '<div class="gif-loading">Функція "Тренди" потребує API ключа GIPHY</div>';
}

function searchGifs() {
    const q = DOM.gifSearchInput.value;
    if(!q) return;
    DOM.gifLibrary.innerHTML = `<div class="gif-loading">Пошук "${q}"... (потребує API)</div>`;
}

function handleGifSelect(e) {
    if(e.target.tagName === 'IMG') {
        const url = e.target.src;
        socket.emit('send_message', {
            recipient_id: activeChatRecipientId, 
            text: null, 
            media_type: 'gif', 
            media_url: url
        });
        closeGifModal();
    }
}

// ЗАПУСК
document.addEventListener('DOMContentLoaded', init);