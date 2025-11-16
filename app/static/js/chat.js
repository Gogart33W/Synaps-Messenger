// HANDLE USER CLICK
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
    chatTitle.style.cursor = 'pointer';
    chatTitle.addEventListener('click', () => {
        window.open(`/user/${newRecipientId}`, '_blank');
    });
    
    const user = allUsers[newRecipientId];
    if (user) {
        createChatHeaderAvatar(user);
        const isOnline = online_users.has(user.id);
        if (isOnline) {
            chatStatus.innerText = 'Онлайн';
            chatStatus.classList.add('online');
            chatStatus.classList.remove('typing');
        } else {
            chatStatus.innerText = formatLastSeen(user.last_seen);
            chatStatus.classList.remove('online', 'typing');
        }
    } else {
        chatStatus.innerText = '...';
        chatStatus.classList.remove('online', 'typing');
    }
    
    input.placeholder = 'Напишіть ' + newUsername + '...';
    input.disabled = false;
    sendButton.disabled = false;
    fileButton.classList.add('active');
    gifButton.disabled = false;
    
    updateUnreadCount(activeChatRecipientId, 0);
    socket.emit('mark_as_read', { 'chat_partner_id': activeChatRecipientId });

    if (chatHistories[activeChatRecipientId]) {
        renderChatHistory(chatHistories[activeChatRecipientId]);
    } else {
        messages.innerHTML = '<li class="status">Завантаження історії...</li>';
        socket.emit('load_history', { 'partner_id': activeChatRecipientId });
    }
    
    if (userSearchInput.value.trim().length > 0) {
        userSearchInput.value = '';
        socket.emit('users_list_request');
    }
}

// RENDER CHAT HISTORY
function renderChatHistory(history) {
    messages.innerHTML = '';
    if (history.length === 0) {
        messages.innerHTML = '<li class="status">Повідомлень ще немає.</li>';
        return;
    }
    history.forEach(msg => renderMessage(msg, false));
    scrollToBottom();
}

// НОВИЙ: Render повідомлення з усіма фічами
function renderMessage(msgData, shouldScroll = true) {
    const item = document.createElement('li');
    item.dataset.messageId = msgData.id;
    const formattedTime = formatUTCToLocal(msgData.timestamp);
    
    if (msgData.sender_id === currentUserId) {
        item.classList.add('my-message');
    }
    
    // Перевірка на видалене повідомлення
    if (msgData.is_deleted) {
        item.classList.add('deleted');
        item.innerHTML = `
            <span>🚫 Повідомлення видалено</span>
            <span class="timestamp">${formattedTime}</span>
        `;
        messages.appendChild(item);
        if (shouldScroll) scrollToBottom();
        return;
    }
    
    let messageContent = '';
    
    // Reply indicator
    if (msgData.reply_to && msgData.reply_to.id) {
        const replyAuthor = msgData.reply_to.sender_name || 'Користувач';
        let replyText = msgData.reply_to.text || '';
        if (msgData.reply_to.is_deleted) {
            replyText = '🚫 Повідомлення видалено';
        } else if (msgData.reply_to.media_type !== 'text') {
            replyText = `[${msgData.reply_to.media_type}]`;
        }
        messageContent += `
            <div class="message-reply-container">
                <div class="message-reply-author">${replyAuthor}</div>
                <div class="message-reply-text">${replyText}</div>
            </div>
        `;
    }
    
    // Forward indicator
    if (msgData.forwarded_from && msgData.forwarded_from.sender_name) {
        messageContent += `
            <div class="message-forwarded">
                📤 Переслано від ${msgData.forwarded_from.sender_name}
            </div>
        `;
    }
    
    // Main content
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
            const tempDiv = document.createElement('div');
            tempDiv.innerText = msgData.text || "";
            messageContent += tempDiv.innerHTML.replace(/\n/g, '<br>');
    }
    
    // Reactions
    let reactionsHtml = '';
    if (msgData.reactions && Object.keys(msgData.reactions).length > 0) {
        reactionsHtml = '<div class="message-reactions">';
        for (const [emoji, users] of Object.entries(msgData.reactions)) {
            const hasMyReaction = users.some(u => u.user_id === currentUserId);
            const reactionClass = hasMyReaction ? 'reaction-item my-reaction' : 'reaction-item';
            const title = users.map(u => u.user_name).join(', ');
            reactionsHtml += `
                <span class="${reactionClass}" data-emoji="${emoji}" data-message-id="${msgData.id}" title="${title}">
                    <span class="reaction-emoji">${emoji}</span>
                    <span class="reaction-count">${users.length}</span>
                </span>
            `;
        }
        reactionsHtml += '</div>';
    }
    
    // Read status
    let readStatus = '';
    if (msgData.sender_id === currentUserId) {
        const readClass = msgData.is_read ? 'read' : '';
        readStatus = `<span class="read-status ${readClass}">${msgData.is_read ? '✓✓' : '✓'}</span>`;
    }
    
    // Context menu
    const contextMenu = createContextMenu(msgData);
    
    item.innerHTML = `
        ${messageContent}
        ${reactionsHtml}
        <span class="timestamp">
            ${formattedTime}
            ${readStatus}
        </span>
        ${contextMenu}
    `;
    
    messages.appendChild(item);
    
    // Image click handler
    const img = item.querySelector('.chat-image');
    if (img) {
        img.addEventListener('click', () => window.open(img.src, '_blank'));
    }
    
    // Reaction click handler
    const reactionItems = item.querySelectorAll('.reaction-item');
    reactionItems.forEach(reactionItem => {
        reactionItem.addEventListener('click', () => {
            const emoji = reactionItem.dataset.emoji;
            const messageId = reactionItem.dataset.messageId;
            socket.emit('add_reaction', { message_id: parseInt(messageId), emoji: emoji });
        });
    });
    
    if (shouldScroll) scrollToBottom();
}

// НОВИЙ: Створення контекстного меню
function createContextMenu(msgData) {
    const canDelete = msgData.sender_id === currentUserId && !msgData.is_deleted;
    
    return `
        <div class="message-context-menu">
            <button class="context-menu-btn" title="Відповісти" onclick="replyToMsg(${msgData.id})">💬</button>
            <button class="context-menu-btn" title="Реакція" onclick="toggleEmojiPicker(${msgData.id})">😊</button>
            ${canDelete ? `<button class="context-menu-btn delete-btn" title="Видалити" onclick="deleteMsg(${msgData.id})">🗑️</button>` : ''}
        </div>
        <div class="emoji-picker" id="emoji-picker-${msgData.id}">
            <div class="emoji-picker-grid">
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '❤️')">❤️</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '👍')">👍</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '😂')">😂</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '😮')">😮</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '😢')">😢</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '🙏')">🙏</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '🔥')">🔥</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '🎉')">🎉</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '💯')">💯</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '👎')">👎</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '😡')">😡</span>
                <span class="emoji-picker-item" onclick="addReaction(${msgData.id}, '🤔')">🤔</span>
            </div>
        </div>
    `;
}

// НОВИЙ: Глобальні функції для кнопок
window.replyToMsg = function(messageId) {
    const msgData = findMessageInHistory(messageId);
    if (!msgData) return;
    
    replyToMessage = msgData;
    showReplyIndicator(msgData);
    input.focus();
};

window.toggleEmojiPicker = function(messageId) {
    const picker = document.getElementById(`emoji-picker-${messageId}`);
    if (!picker) return;
    
    // Закриваємо всі інші picker'и
    document.querySelectorAll('.emoji-picker').forEach(p => {
        if (p.id !== `emoji-picker-${messageId}`) {
            p.classList.remove('visible');
        }
    });
    
    picker.classList.toggle('visible');
};

window.addReaction = function(messageId, emoji) {
    socket.emit('add_reaction', { message_id: messageId, emoji: emoji });
    const picker = document.getElementById(`emoji-picker-${messageId}`);
    if (picker) picker.classList.remove('visible');
};

window.deleteMsg = function(messageId) {
    if (confirm('Видалити це повідомлення?')) {
        socket.emit('delete_message', { message_id: messageId });
    }
};

// НОВИЙ: Reply indicator
function showReplyIndicator(msgData) {
    const indicator = document.getElementById('reply-indicator');
    if (!indicator) {
        const newIndicator = document.createElement('div');
        newIndicator.id = 'reply-indicator';
        newIndicator.className = 'visible';
        
        let replyText = msgData.text || '';
        if (msgData.media_type !== 'text') {
            replyText = `[${msgData.media_type}]`;
        }
        
        newIndicator.innerHTML = `
            <div id="reply-indicator-content">
                <div id="reply-indicator-author">${msgData.sender_display_name || msgData.sender_username}</div>
                <div id="reply-indicator-text">${replyText}</div>
            </div>
            <button id="reply-cancel-btn">✕</button>
        `;
        
        const form = document.getElementById('form');
        form.parentElement.insertBefore(newIndicator, form);
        
        document.getElementById('reply-cancel-btn').addEventListener('click', hideReplyIndicator);
    } else {
        indicator.classList.add('visible');
        let replyText = msgData.text || '';
        if (msgData.media_type !== 'text') {
            replyText = `[${msgData.media_type}]`;
        }
        document.getElementById('reply-indicator-author').innerText = msgData.sender_display_name || msgData.sender_username;
        document.getElementById('reply-indicator-text').innerText = replyText;
    }
}

function hideReplyIndicator() {
    const indicator = document.getElementById('reply-indicator');
    if (indicator) {
        indicator.classList.remove('visible');
    }
    replyToMessage = null;
}

function findMessageInHistory(messageId) {
    for (const partnerId in chatHistories) {
        const msg = chatHistories[partnerId].find(m => m.id === messageId);
        if (msg) return msg;
    }
    return null;
}

function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

// SEND MESSAGE
function sendMessage() {
    const text = input.value.trim();
    if (!text || !activeChatRecipientId) return;
    
    // Зупиняємо typing indicator
    if (isTyping) {
        clearTimeout(typingTimeout);
        socket.emit('typing_stop', { partner_id: activeChatRecipientId });
        isTyping = false;
    }
    
    let payload = {
        'text': null,
        'media_url': null,
        'media_type': 'text',
        'recipient_id': activeChatRecipientId,
        'reply_to_id': replyToMessage ? replyToMessage.id : null,
        'forwarded_from_id': null
    };
    
    if (isGifUrl(text)) {
        payload.media_type = 'gif';
        payload.media_url = text;
    } else {
        payload.media_type = 'text';
        payload.text = text;
    }
    
    socket.emit('send_message', payload);
    input.value = "";
    hideReplyIndicator();
}

function sendGif(gifUrl) {
    if (!activeChatRecipientId) return;
    socket.emit('send_message', {
        'text': null,
        'media_url': gifUrl,
        'media_type': 'gif',
        'recipient_id': activeChatRecipientId,
        'reply_to_id': replyToMessage ? replyToMessage.id : null
    });
    hideReplyIndicator();
}

function handleInputKeypress(e) {
    if (e.key === 'Enter') sendMessage();
}

// FILE UPLOAD
function uploadFile(file) {
    if (!file || !activeChatRecipientId) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('recipient_id', activeChatRecipientId);
    
    let text = "<i>Завантаження...</i>";
    if (file.type.startsWith('image/')) text = "<i>Завантаження фото...</i>";
    if (file.type.startsWith('video/')) text = "<i>Завантаження відео...</i>";
    renderMessage({
        sender_id: currentUserId, text: text,
        media_type: 'text', timestamp: new Date().toISOString()
    }, true);
    
    fetch('/upload', { method: 'POST', body: formData })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            alert('Помилка завантаження: ' + data.error);
        }
    })
    .catch(error => console.error('Upload error:', error));
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) uploadFile(file);
    e.target.value = null;
}

// GIF MODAL
function openGifModal() {
    if (gifButton.disabled) return;
    gifModal.classList.add('modal-visible');
    if (currentGifTab === 'trending') {
        loadTrendingGifs();
    }
}

function closeGifModal() {
    gifModal.classList.remove('modal-visible');
}

function handleModalClick(e) {
    if (e.target === gifModal) closeGifModal();
}

function handleGifSelect(e) {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('gif-item')) {
        const gifUrl = e.target.dataset.gifUrl || e.target.src;
        sendGif(gifUrl);
        closeGifModal();
    }
}

// UTILITIES
function formatUTCToLocal(utcString) {
    if (!utcString) return '';
    try {
        const date = new Date(utcString);
        return date.toLocaleString('uk-UA', {
            hour: '2-digit', minute: '2-digit',
            day: '2-digit', month: 'short'
        });
    } catch (e) {
        console.error("Error formatting date:", e);
        return utcString;
    }
}

function formatLastSeen(isoString) {
    if (!isoString) return "був давно";
    const date = new Date(isoString);
    const now = new Date();
    const timeOpts = { hour: '2-digit', minute: '2-digit' };
    if (date.toDateString() === now.toDateString()) {
        return `був сьогодні о ${date.toLocaleString('uk-UA', timeOpts)}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `був вчора о ${date.toLocaleString('uk-UA', timeOpts)}`;
    }
    return `був ${date.toLocaleString('uk-UA', { day: '2-digit', month: 'short' })}`;
}

function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "denied") {
        Notification.requestPermission();
    }
}

function showNotification(title, body) {
    if (Notification.permission === "granted" && document.hidden) {
        new Notification(title, { body: body, icon: '/favicon.ico' });
    }
}

// SOCKET.IO HANDLERS
socket.on('connect', () => console.log('Socket connected'));
socket.on('disconnect', () => console.log('Socket disconnected'));

// --- ОНОВЛЕНО ТУТ ---
socket.on('users_list', data => {
    online_users.clear();
    data.online_ids.forEach(id => online_users.add(id));
    
    // Перевіряємо, що ми не в режимі пошуку
    if (userSearchInput.value.trim().length === 0) {
        
        // (НОВЕ) Перевіряємо, чи список чатів порожній
        if (data.users.length === 0) {
            userList.innerHTML = '<li class="status">У вас ще немає чатів. Знайдіть когось!</li>';
        } else {
            // (СТАРЕ) Якщо не порожній, рендеримо
            // Примітка: Функція renderUserList має існувати
            // у першій частині твого файлу, яку ти не надав
            renderUserList(data.users, data.online_ids, 'chats');
        }
    }
});
// --- КІНЕЦЬ ОНОВЛЕННЯ ---

socket.on('chat_list_error', data => {
    console.error('Помилка завантаження чатів:', data.error);
    userList.innerHTML = `<li class="status">Помилка завантаження чатів 😵</li>`;
});

socket.on('force_chat_list_update', () => {
    console.log('Force updating chat list...');
    socket.emit('users_list_request');
});

socket.on('new_message', function(data) {
    const senderId = parseInt(data.sender_id, 10);
    const recipientId = parseInt(data.recipient_id, 10);
    const chatPartnerId = senderId === currentUserId ? recipientId : senderId;
    if (!chatHistories[chatPartnerId]) chatHistories[chatPartnerId] = [];
    chatHistories[chatPartnerId].push(data);
    if (chatPartnerId === activeChatRecipientId) {
        if (messages.querySelector('.status')) messages.innerHTML = '';
        renderMessage(data, true);
        if (senderId !== currentUserId) {
            socket.emit('mark_as_read', { 'chat_partner_id': senderId });
        }
    }
});

socket.on('unread_message', function(data) {
    const senderId = parseInt(data.sender_id, 10);
    if (senderId !== activeChatRecipientId) {
        const newCount = (unreadCounts[senderId] || 0) + 1;
        updateUnreadCount(senderId, newCount);
        let body = "[Нове повідомлення]";
        if(data.media_type === 'text') body = data.text;
        if(data.media_type === 'image') body = "[Фотографія]";
        if(data.media_type === 'video') body = "[Відео]";
        if(data.media_type === 'gif') body = "[GIF]";
        showNotification(data.sender_username, body);
    }
});

socket.on('history_loaded', function(data) {
    const partnerId = parseInt(data.partner_id, 10);
    chatHistories[partnerId] = data.history;
    if (partnerId === activeChatRecipientId) {
        renderChatHistory(data.history);
    }
});

socket.on('messages_were_read', function(data) {
    const partnerId = parseInt(data.reader_id, 10);
    if (chatHistories[partnerId]) {
        chatHistories[partnerId].forEach(msg => {
            if (data.message_ids.includes(msg.id)) msg.is_read = true;
        });
    }
    if (partnerId === activeChatRecipientId) {
        data.message_ids.forEach(messageId => {
            const msgElement = messages.querySelector(`li[data-message-id="${messageId}"]`);
            if (msgElement) {
                const statusElement = msgElement.querySelector('.read-status');
                if (statusElement) {
                    statusElement.innerHTML = '✓✓';
                    statusElement.classList.add('read');
                }
            }
        });
    }
});

// НОВИЙ: Видалення повідомлення
socket.on('message_deleted', function(data) {
    const messageId = data.id;
    const senderId = data.sender_id;
    const recipientId = data.recipient_id;
    const chatPartnerId = senderId === currentUserId ? recipientId : senderId;
    
    // ВИПРАВЛЕНО: Оновлюємо в історії, але НЕ обнуляємо дані
    if (chatHistories[chatPartnerId]) {
        const msg = chatHistories[chatPartnerId].find(m => m.id === messageId);
        if (msg) {
            msg.is_deleted = true;
            // НЕ обнуляємо text і media_url - вони потрібні для reply
        }
    }
    
    // Оновлюємо на екрані
    if (chatPartnerId === activeChatRecipientId) {
        const msgElement = messages.querySelector(`li[data-message-id="${messageId}"]`);
        if (msgElement) {
            msgElement.classList.add('deleted');
            msgElement.innerHTML = `
                <span>🚫 Повідомлення видалено</span>
                <span class="timestamp">${formatUTCToLocal(data.timestamp)}</span>
            `;
        }
    }
});

// НОВИЙ: Оновлення реакцій
socket.on('reaction_updated', function(data) {
    const messageId = data.message_id;
    const reactions = data.reactions;
    
    const msgElement = messages.querySelector(`li[data-message-id="${messageId}"]`);
    if (!msgElement) return;
    
    // Видаляємо старі реакції
    const oldReactions = msgElement.querySelector('.message-reactions');
    if (oldReactions) oldReactions.remove();
    
    // Додаємо нові реакції
    if (Object.keys(reactions).length > 0) {
        let reactionsHtml = '<div class="message-reactions">';
        for (const [emoji, users] of Object.entries(reactions)) {
            const hasMyReaction = users.some(u => u.user_id === currentUserId);
            const reactionClass = hasMyReaction ? 'reaction-item my-reaction' : 'reaction-item';
            const title = users.map(u => u.user_name).join(', ');
            reactionsHtml += `
                <span class="${reactionClass}" data-emoji="${emoji}" data-message-id="${messageId}" title="${title}">
                    <span class="reaction-emoji">${emoji}</span>
                    <span class="reaction-count">${users.length}</span>
                </span>
            `;
        }
        reactionsHtml += '</div>';
        
        const timestamp = msgElement.querySelector('.timestamp');
        timestamp.insertAdjacentHTML('beforebegin', reactionsHtml);
        
        // Додаємо обробники
        const reactionItems = msgElement.querySelectorAll('.reaction-item');
        reactionItems.forEach(item => {
            item.addEventListener('click', () => {
                const emoji = item.dataset.emoji;
                socket.emit('add_reaction', { message_id: messageId, emoji: emoji });
            });
        });
    }
    
    // Оновлюємо в історії
    for (const partnerId in chatHistories) {
        const msg = chatHistories[partnerId].find(m => m.id === messageId);
        if (msg) {
            msg.reactions = reactions;
            break;
        }
    }
});

// НОВИЙ: Typing indicator
socket.on('typing_status', function(data) {
    const userId = parseInt(data.user_id, 10);
    const isTyping = data.is_typing;
    
    if (userId === activeChatRecipientId) {
        if (isTyping) {
            chatStatus.innerText = 'друкує...';
            chatStatus.classList.add('typing');
            chatStatus.classList.remove('online');
        } else {
            const user = allUsers[userId];
            if (user && online_users.has(userId)) {
                chatStatus.innerText = 'Онлайн';
                chatStatus.classList.add('online');
                chatStatus.classList.remove('typing');
            } else if (user) {
                chatStatus.innerText = formatLastSeen(user.last_seen);
                chatStatus.classList.remove('online', 'typing');
            }
        }
    }
});

socket.on('user_status_change', function(data) {
    const userId = parseInt(data.user_id, 10);
    const userItem = findUserListItem(userId);
    
    if (data.status === 'online') {
        online_users.add(userId);
        if (userItem) userItem.classList.add('online');
    } else {
        online_users.delete(userId);
        if (userItem) userItem.classList.remove('online');
    }
    
    if(allUsers[userId]) {
        allUsers[userId].last_seen = data.last_seen;
    }
    
    if (userItem) {
        const subtitleEl = userItem.querySelector('.last-seen, .last-message');
        if (subtitleEl) {
            const isOnline = data.status === 'online';
            const type = userSearchInput.value.trim().length > 0 ? 'search' : 'chats';
            
            if (isOnline) {
                subtitleEl.outerHTML = `<span class="last-seen">Онлайн</span>`;
                userItem.querySelector('.last-seen').style.color = 'var(--success)';
            } else {
                if (type === 'chats' && allUsers[userId]) {
                    const lastMsg = allUsers[userId].last_message_text || '...';
                    subtitleEl.outerHTML = `<span class="last-message">${lastMsg}</span>`;
                } else {
                    subtitleEl.outerHTML = `<span class="last-seen">${formatLastSeen(data.last_seen)}</span>`;
                }
            }
        }
    }
    
    if (userId === activeChatRecipientId) {
        if (data.status === 'online') {
            chatStatus.innerText = 'Онлайн';
            chatStatus.classList.add('online');
            chatStatus.classList.remove('typing');
        } else {
            chatStatus.innerText = formatLastSeen(data.last_seen);
            chatStatus.classList.remove('online', 'typing');
        }
    }
});

socket.on('my_gifs_loaded', function(data) {
    if (data.gifs.length === 0) {
        gifLibrary.innerHTML = '<div class="gif-loading">Ви ще не відправляли GIF 😢</div>';
        return;
    }
    gifLibrary.innerHTML = '';
    data.gifs.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'gif-item';
        gifLibrary.appendChild(img);
    });
});

// ЗАПУСК
document.addEventListener('DOMContentLoaded', init);