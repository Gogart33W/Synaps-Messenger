// ======================================================
// === ГЛОБАЛЬНІ ЗМІННІ ТА ІНІЦІАЛІЗАЦІЯ
// ======================================================

let activeChatRecipientId = null;
let activeUserItem = null;
let replyToMessage = null;
let isTyping = false;
let typingTimeout = null;

const allUsers = {};
const chatHistories = {};
const unreadCounts = {};
const online_users = new Set();

let socket;
let userList, userSearchInput, messages, input, sendButton, fileButton, gifButton, wrapper, chatTitle, chatStatus, fileInput, backToChatsBtn;
let gifModal, gifCloseButton, gifTabs, gifSearchContainer, gifSearchInput, gifSearchButton, gifLibrary;
let currentGifTab = 'trending';

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

function init() {
    socket = io();
    wrapper = document.getElementById('content-wrapper');
    const currentUserIdStr = wrapper.dataset.currentUserId;
    window.currentUserId = parseInt(currentUserIdStr, 10);

    userList = document.getElementById('user-list');
    userSearchInput = document.getElementById('user-search-input');
    messages = document.getElementById('messages');
    input = document.getElementById('message_input');
    sendButton = document.getElementById('send_button');
    fileButton = document.getElementById('file_button');
    fileInput = document.getElementById('file_input');
    gifButton = document.getElementById('gif_button');
    chatTitle = document.getElementById('chat-with-title');
    chatStatus = document.getElementById('chat-with-status');
    backToChatsBtn = document.getElementById('back-to-chats-btn');
    
    gifModal = document.getElementById('gif-modal');
    gifCloseButton = document.getElementById('gif-close-button');
    gifTabs = document.querySelectorAll('.gif-tab');
    gifSearchContainer = document.getElementById('gif-search-container');
    gifSearchInput = document.getElementById('gif-search-input');
    gifSearchButton = document.getElementById('gif-search-button');
    gifLibrary = document.getElementById('gif-library');

    userList.addEventListener('click', handleUserListClick);
    userSearchInput.addEventListener('input', debounce(handleSearchInput, 300));

    sendButton.addEventListener('click', sendMessage);
    input.addEventListener('keypress', handleInputKeypress);
    input.addEventListener('input', handleTyping);

    fileInput.addEventListener('change', handleFileSelect);
    gifButton.addEventListener('click', openGifModal);
    gifCloseButton.addEventListener('click', closeGifModal);
    gifModal.addEventListener('click', handleModalClick);
    gifLibrary.addEventListener('click', handleGifSelect);
    gifSearchButton.addEventListener('click', searchGifs);
    gifTabs.forEach(tab => tab.addEventListener('click', () => switchGifTab(tab.dataset.tab)));
    
    backToChatsBtn.addEventListener('click', () => {
        wrapper.classList.remove('chat-view-active');
        activeChatRecipientId = null;
        if(activeUserItem) activeUserItem.classList.remove('active');
        activeUserItem = null;
        chatTitle.innerText = "Будь ласка, оберіть чат";
        chatStatus.innerText = "";
    });

    setupSocketHandlers();
}

// ======================================================
// === ЛОГІКА ПОШУКУ
// ======================================================

async function handleSearchInput(e) {
    const query = e.target.value.trim();
    
    if (query.length < 2) {
        if (query.length === 0) {
            // Якщо поле очистили - показуємо звичайний список
            socket.emit('users_list_request');
        }
        return;
    }

    userList.innerHTML = '<li class="status">Пошук...</li>';
    
    try {
        const response = await fetch('/search_users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        });
        
        const data = await response.json();
        
        if (data.users.length === 0) {
            userList.innerHTML = '<li class="status">Нікого не знайдено 😢</li>';
        } else {
            renderUserList(data.users, online_users, 'search');
        }
    } catch (error) {
        console.error('Помилка пошуку:', error);
        userList.innerHTML = '<li class="status">Помилка пошуку 😵</li>';
    }
}

// ======================================================
// === РЕНДЕР СПИСКУ ЧАТІВ
// ======================================================

function renderUserList(users, onlineIds, type = 'chats') {
    userList.innerHTML = '';
    
    if (users.length === 0 && type === 'chats') {
         userList.innerHTML = '<li class="status">У вас ще немає чатів. Знайдіть когось!</li>';
         return;
    }
    
    users.forEach(user => {
        allUsers[user.id] = user;
        
        const isOnline = onlineIds.has(user.id);
        const item = document.createElement('li');
        item.className = `user-item ${isOnline ? 'online' : ''}`;
        item.dataset.id = user.id;
        item.dataset.username = user.display_name;

        let avatarHtml;
        if (user.avatar_url) {
            avatarHtml = `<img src="${user.avatar_url}" alt="Avatar" class="user-avatar-img">`;
        } else {
            const placeholder = user.username[0].toUpperCase();
            avatarHtml = `<div class="user-avatar-placeholder">${placeholder}</div>`;
        }
        
        let subtitleHtml;
        if (type === 'chats') {
            subtitleHtml = `<span class="last-message">${user.last_message_text || '...'}</span>`;
        } else {
            subtitleHtml = `<span class="last-seen">${isOnline ? 'Онлайн' : formatLastSeen(user.last_seen)}</span>`;
        }
        
        const unreadCount = unreadCounts[user.id] || 0;

        item.innerHTML = `
            <div class="avatar-wrapper">
                <div class="user-avatar-container">${avatarHtml}</div>
                <div class="status-dot"></div>
            </div>
            <div class="user-info">
                <span class="username">${user.display_name}</span>
                ${subtitleHtml}
            </div>
            <span class="unread-badge" style="display: ${unreadCount > 0 ? 'block' : 'none'}">${unreadCount}</span>
        `;
        
        if (user.id === activeChatRecipientId) {
            item.classList.add('active');
            activeUserItem = item;
        }
        
        userList.appendChild(item);
    });
}

// ======================================================
// === РЕНДЕР ПОВІДОМЛЕНЬ ТА ІНТЕРФЕЙС
// ======================================================

function renderMessage(msgData, shouldScroll = true) {
    const item = document.createElement('li');
    item.dataset.messageId = msgData.id;
    const formattedTime = formatUTCToLocal(msgData.timestamp);
    
    if (msgData.sender_id === currentUserId) {
        item.classList.add('my-message');
    }
    
    if (msgData.is_deleted) {
        item.classList.add('deleted');
        item.innerHTML = `<span>🚫 Повідомлення видалено</span><span class="timestamp">${formattedTime}</span>`;
        messages.appendChild(item);
        if (shouldScroll) scrollToBottom();
        return;
    }
    
    let messageContent = '';
    
    // Reply
    if (msgData.reply_to && msgData.reply_to.id) {
        const replyAuthor = msgData.reply_to.sender_name || 'Користувач';
        let replyText = msgData.reply_to.text || '';
        if (msgData.reply_to.is_deleted) replyText = '🚫 Повідомлення видалено';
        else if (msgData.reply_to.media_type !== 'text') replyText = `[${msgData.reply_to.media_type}]`;
        
        messageContent += `
            <div class="message-reply-container">
                <div class="message-reply-author">${replyAuthor}</div>
                <div class="message-reply-text">${replyText}</div>
            </div>
        `;
    }
    
    // Forward
    if (msgData.forwarded_from && msgData.forwarded_from.sender_name) {
        messageContent += `<div class="message-forwarded">📤 Переслано від ${msgData.forwarded_from.sender_name}</div>`;
    }
    
    // Media/Text
    switch(msgData.media_type) {
        case 'image':
        case 'gif':
            messageContent += `<img src="${msgData.media_url || msgData.text}" alt="Зображення" class="chat-image">`;
            break;
        case 'video':
            messageContent += `<video src="${msgData.media_url}" class="chat-video" controls></video>`;
            break;
        case 'text':
        default:
            messageContent += `<div>${(msgData.text || "").replace(/\n/g, '<br>')}</div>`;
    }
    
    // Reactions
    let reactionsHtml = '';
    if (msgData.reactions && Object.keys(msgData.reactions).length > 0) {
        reactionsHtml = '<div class="message-reactions">';
        for (const [emoji, users] of Object.entries(msgData.reactions)) {
            const hasMyReaction = users.some(u => u.user_id === currentUserId);
            const reactionClass = hasMyReaction ? 'reaction-item my-reaction' : 'reaction-item';
            reactionsHtml += `
                <span class="${reactionClass}" data-emoji="${emoji}" data-message-id="${msgData.id}" title="${users.map(u => u.user_name).join(', ')}">
                    <span class="reaction-emoji">${emoji}</span>
                    <span class="reaction-count">${users.length}</span>
                </span>
            `;
        }
        reactionsHtml += '</div>';
    }
    
    // Read Status & Menu
    const readStatus = (msgData.sender_id === currentUserId) 
        ? `<span class="read-status ${msgData.is_read ? 'read' : ''}">${msgData.is_read ? '✓✓' : '✓'}</span>` 
        : '';
        
    const contextMenu = createContextMenu(msgData);
    
    item.innerHTML = `
        ${messageContent}
        ${reactionsHtml}
        <span class="timestamp">${formattedTime} ${readStatus}</span>
        ${contextMenu}
    `;
    
    messages.appendChild(item);
    
    // Listeners
    const img = item.querySelector('.chat-image');
    if (img) img.addEventListener('click', () => window.open(img.src, '_blank'));
    
    item.querySelectorAll('.reaction-item').forEach(ri => {
        ri.addEventListener('click', () => {
            socket.emit('add_reaction', { message_id: parseInt(ri.dataset.messageId), emoji: ri.dataset.emoji });
        });
    });
    
    if (shouldScroll) scrollToBottom();
}

function createContextMenu(msgData) {
    const canDelete = msgData.sender_id === currentUserId;
    return `
        <div class="message-context-menu">
            <button class="context-menu-btn" title="Відповісти" onclick="replyToMsg(${msgData.id})">↩️</button>
            <button class="context-menu-btn" title="Реакція" onclick="toggleEmojiPicker(${msgData.id})">😀</button>
            ${canDelete ? `<button class="context-menu-btn delete-btn" title="Видалити" onclick="deleteMsg(${msgData.id})">🗑️</button>` : ''}
        </div>
        <div class="emoji-picker" id="emoji-picker-${msgData.id}">
            <div class="emoji-picker-grid">
                ${['❤️','👍','😂','😮','😢','🙏','🔥','🎉'].map(e => 
                    `<span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '${e}')">${e}</span>`
                ).join('')}
            </div>
        </div>
    `;
}

// Глобальні функції
window.replyToMsg = (id) => {
    const msg = findMessageInHistory(id);
    if (msg) {
        replyToMessage = msg;
        showReplyIndicator(msg);
        input.focus();
    }
};

window.toggleEmojiPicker = (id) => {
    document.querySelectorAll('.emoji-picker').forEach(p => {
        if(p.id !== `emoji-picker-${id}`) p.classList.remove('visible');
    });
    const picker = document.getElementById(`emoji-picker-${id}`);
    if (picker) picker.classList.toggle('visible');
};

window.addReaction = (id, emoji) => {
    socket.emit('add_reaction', { message_id: id, emoji: emoji });
    window.toggleEmojiPicker(id);
};

window.deleteMsg = (id) => {
    if (confirm('Видалити?')) socket.emit('delete_message', { message_id: id });
};

function findMessageInHistory(id) {
    for (const uid in chatHistories) {
        const m = chatHistories[uid].find(x => x.id === id);
        if (m) return m;
    }
    return null;
}

function showReplyIndicator(msg) {
    const ind = document.getElementById('reply-indicator');
    ind.className = 'visible';
    const txt = msg.media_type === 'text' ? msg.text : `[${msg.media_type}]`;
    document.getElementById('reply-indicator-author').innerText = msg.sender_display_name;
    document.getElementById('reply-indicator-text').innerText = txt;
    
    document.getElementById('reply-cancel-btn').onclick = hideReplyIndicator;
}

function hideReplyIndicator() {
    document.getElementById('reply-indicator').className = '';
    replyToMessage = null;
}

function handleUserListClick(e) {
    const clickedUser = e.target.closest('.user-item');
    if (!clickedUser) return;
    
    wrapper.classList.add('chat-view-active');
    requestNotificationPermission();
    
    const newRecipientId = parseInt(clickedUser.dataset.id, 10);
    const newUsername = clickedUser.dataset.username;
    
    if (activeUserItem) activeUserItem.classList.remove('active');
    activeChatRecipientId = newRecipientId;
    activeUserItem = clickedUser;
    activeUserItem.classList.add('active');
    replyToMessage = null;
    hideReplyIndicator();
    
    chatTitle.innerText = newUsername;
    const user = allUsers[newRecipientId];
    
    if (user) {
        createChatHeaderAvatar(user);
        chatStatus.innerText = online_users.has(user.id) ? 'Онлайн' : formatLastSeen(user.last_seen);
        if(online_users.has(user.id)) chatStatus.className = 'chat-status-subtitle online';
    }
    
    input.placeholder = `Напишіть ${newUsername}...`;
    input.disabled = false;
    sendButton.disabled = false;
    fileButton.classList.add('active');
    gifButton.disabled = false;
    
    updateUnreadCount(newRecipientId, 0);
    socket.emit('mark_as_read', { 'chat_partner_id': newRecipientId });

    if (chatHistories[newRecipientId]) {
        renderChatHistory(chatHistories[newRecipientId]);
    } else {
        messages.innerHTML = '<li class="status">Завантаження...</li>';
        socket.emit('load_history', { 'partner_id': newRecipientId });
    }
    
    if (userSearchInput.value.trim().length > 0) {
        userSearchInput.value = '';
        socket.emit('users_list_request');
    }
}

function renderChatHistory(history) {
    messages.innerHTML = '';
    if (!history.length) {
        messages.innerHTML = '<li class="status">Тут поки що пусто. Напишіть першим!</li>';
        return;
    }
    history.forEach(msg => renderMessage(msg, false));
    scrollToBottom();
}

function sendMessage() {
    const text = input.value.trim();
    if (!text || !activeChatRecipientId) return;
    
    socket.emit('send_message', {
        recipient_id: activeChatRecipientId,
        text: text,
        media_type: isGifUrl(text) ? 'gif' : 'text',
        media_url: isGifUrl(text) ? text : null,
        reply_to_id: replyToMessage ? replyToMessage.id : null
    });
    
    input.value = "";
    hideReplyIndicator();
}

// === SOCKET HANDLERS ===
function setupSocketHandlers() {
    socket.on('connect', () => console.log('Connected'));
    
    socket.on('users_list', data => {
        online_users.clear();
        data.online_ids.forEach(id => online_users.add(id));
        // Якщо ми не шукаємо когось конкретного, оновлюємо список
        if (userSearchInput.value.trim().length === 0) {
            renderUserList(data.users, online_users, 'chats');
        }
    });
    
    socket.on('new_message', data => {
        const pid = (data.sender_id === currentUserId) ? data.recipient_id : data.sender_id;
        
        if (!chatHistories[pid]) chatHistories[pid] = [];
        chatHistories[pid].push(data);
        
        if (pid === activeChatRecipientId) {
            // Прибираємо статус "пусто", якщо він є
            if (messages.querySelector('.status')) messages.innerHTML = '';
            renderMessage(data, true);
            if (data.sender_id !== currentUserId) socket.emit('mark_as_read', { chat_partner_id: data.sender_id });
        }
    });
    
    socket.on('history_loaded', data => {
        chatHistories[data.partner_id] = data.history;
        if (data.partner_id === activeChatRecipientId) renderChatHistory(data.history);
    });
    
    socket.on('user_status_change', data => {
        if (data.status === 'online') online_users.add(data.user_id);
        else online_users.delete(data.user_id);
        
        // Оновлюємо статус в хедері, якщо чат відкритий
        if (activeChatRecipientId === data.user_id) {
            chatStatus.innerText = (data.status === 'online') ? 'Онлайн' : formatLastSeen(data.last_seen);
            chatStatus.className = `chat-status-subtitle ${data.status === 'online' ? 'online' : ''}`;
        }
        
        // Оновлюємо точку в списку (знаходимо елемент і міняємо клас)
        const item = userList.querySelector(`.user-item[data-id="${data.user_id}"]`);
        if (item) {
            if (data.status === 'online') item.classList.add('online');
            else item.classList.remove('online');
        }
    });
    
    socket.on('reaction_updated', data => {
        // Знаходимо повідомлення в DOM
        const li = document.querySelector(`li[data-message-id="${data.message_id}"]`);
        if (!li) return; // Якщо повідомлення не на екрані
        
        // Видаляємо старі реакції
        const oldDiv = li.querySelector('.message-reactions');
        if (oldDiv) oldDiv.remove();
        
        // Рендеримо нові
        if (Object.keys(data.reactions).length > 0) {
            let html = '<div class="message-reactions">';
            for (const [emoji, users] of Object.entries(data.reactions)) {
                const iReacted = users.some(u => u.user_id === currentUserId);
                html += `<span class="reaction-item ${iReacted ? 'my-reaction' : ''}" onclick="addReaction(${data.message_id}, '${emoji}')">
                    <span class="reaction-emoji">${emoji}</span><span class="reaction-count">${users.length}</span>
                </span>`;
            }
            html += '</div>';
            li.querySelector('.timestamp').insertAdjacentHTML('beforebegin', html);
        }
    });
    
    socket.on('message_deleted', data => {
        // Оновлюємо історію в пам'яті
        const pid = (data.sender_id === currentUserId) ? data.recipient_id : data.sender_id;
        const msg = chatHistories[pid]?.find(m => m.id === data.id);
        if (msg) msg.is_deleted = true;
        
        // Оновлюємо DOM
        if (pid === activeChatRecipientId) {
            const li = document.querySelector(`li[data-message-id="${data.id}"]`);
            if (li) {
                li.classList.add('deleted');
                li.innerHTML = `<span>🚫 Повідомлення видалено</span><span class="timestamp">${formatUTCToLocal(data.timestamp)}</span>`;
            }
        }
    });
}

// Додаткові хелпери
function createChatHeaderAvatar(user) {
    const wrap = document.getElementById('chat-title-wrapper');
    const old = document.getElementById('chat-header-avatar');
    if(old) old.remove();
    
    const div = document.createElement('div');
    div.id = 'chat-header-avatar';
    div.className = 'chat-header-avatar';
    div.innerHTML = user.avatar_url 
        ? `<img src="${user.avatar_url}">` 
        : `<div class="chat-header-avatar-placeholder">${user.username[0].toUpperCase()}</div>`;
    wrap.before(div);
}

function formatLastSeen(iso) {
    if(!iso) return "";
    const d = new Date(iso);
    return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function formatUTCToLocal(iso) {
    if(!iso) return "";
    return new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function isGifUrl(t) { return t.startsWith('http') && (t.includes('giphy') || t.includes('tenor') || t.endsWith('.gif')); }
function handleTyping() { /* ... */ }
function handleFileSelect() { /* ... */ }
function openGifModal() { /* ... */ }
function closeGifModal() { document.getElementById('gif-modal').classList.remove('modal-visible'); }
function handleModalClick(e) { if(e.target.id === 'gif-modal') closeGifModal(); }
function handleGifSelect() { /* ... */ }
function searchGifs() { /* ... */ }
function switchGifTab() { /* ... */ }
function updateUnreadCount() { /* ... */ }
function requestNotificationPermission() { /* ... */ }
function scrollToBottom() { messages.scrollTop = messages.scrollHeight; }
function handleInputKeypress(e) { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

document.addEventListener('DOMContentLoaded', init);