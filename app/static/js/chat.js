// ===== ГЛОБАЛЬНІ ЗМІННІ =====
const chatHistories = {};
const unreadCounts = {};
const allUsers = {};

const wrapper = document.getElementById('content-wrapper');
const currentUserId = parseInt(wrapper.dataset.currentUserId, 10);
const currentUsername = wrapper.querySelector('nav strong')?.textContent || 'User';

let activeChatRecipientId = null;
let activeUserItem = null;

// ===== DOM ЕЛЕМЕНТИ =====
const socket = io();
const messages = document.getElementById('messages');
const input = document.getElementById('message_input');
const sendButton = document.getElementById('send_button');
const userList = document.getElementById('user-list');
const chatTitle = document.getElementById('chat-with-title');
const fileInput = document.getElementById('file_input');
const fileButton = document.getElementById('file_button');
const gifButton = document.getElementById('gif_button');
const gifModal = document.getElementById('gif-modal');
const gifLibrary = document.getElementById('gif-library');
const gifCloseButton = document.getElementById('gif-close-button');

// ===== ІНІЦІАЛІЗАЦІЯ =====
function init() {
    setupEventListeners();
    setupPasteSupport();
    setupDragAndDrop();
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    userList.addEventListener('click', handleUserClick);
    sendButton.addEventListener('click', sendMessage);
    input.addEventListener('keypress', handleInputKeypress);
    fileInput.addEventListener('change', handleFileSelect);
    gifButton.addEventListener('click', openGifModal);
    gifCloseButton.addEventListener('click', closeGifModal);
    gifModal.addEventListener('click', handleModalClick);
    gifLibrary.addEventListener('click', handleGifSelect);
}

// ===== PASTE SUPPORT (для стікерів з клавіатури) =====
function setupPasteSupport() {
    input.addEventListener('paste', function(e) {
        if (!activeChatRecipientId) return;
        
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        console.log('Paste event, items:', items.length);
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            console.log('Item type:', item.type);
            
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) {
                    console.log('Image pasted, uploading...');
                    uploadFile(blob);
                    return;
                }
            }
        }
    });
}

// ===== DRAG & DROP SUPPORT =====
function setupDragAndDrop() {
    const chatWindow = document.getElementById('chat_window');
    
    chatWindow.addEventListener('dragover', function(e) {
        if (!activeChatRecipientId) return;
        e.preventDefault();
        e.stopPropagation();
        chatWindow.style.background = '#f0f8ff';
    });
    
    chatWindow.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        chatWindow.style.background = '';
    });
    
    chatWindow.addEventListener('drop', function(e) {
        if (!activeChatRecipientId) return;
        e.preventDefault();
        e.stopPropagation();
        chatWindow.style.background = '';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            console.log('File dropped:', files[0].type);
            uploadFile(files[0]);
        }
    });
}

// ===== USER LIST =====
function renderUserList(users, onlineIds) {
    userList.innerHTML = '';
    users.forEach(user => {
        allUsers[user.id] = user;
        const isOnline = onlineIds.includes(user.id);
        const item = document.createElement('li');
        item.className = 'user-item';
        item.dataset.id = user.id;
        item.dataset.username = user.username;
        if (isOnline) {
            item.classList.add('online');
        }
        item.innerHTML = `
            <span class="status-dot"></span>
            <div class="user-info">
                <span class="username">${user.username}</span>
                <span class="last-seen">${isOnline ? 'Онлайн' : formatLastSeen(user.last_seen)}</span>
            </div>
            <span class="unread-badge"></span>
        `;
        userList.appendChild(item);
    });
}

function findUserListItem(userId) {
    userId = parseInt(userId, 10);
    return userList.querySelector(`.user-item[data-id="${userId}"]`);
}

function updateUnreadCount(userId, count) {
    userId = parseInt(userId, 10);
    unreadCounts[userId] = count;
    const userItem = findUserListItem(userId);
    if (!userItem) return;
    
    const badge = userItem.querySelector('.unread-badge');
    if (count > 0) {
        badge.innerText = count;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
}

function handleUserClick(e) {
    requestNotificationPermission();
    const clickedUser = e.target.closest('.user-item');
    if (!clickedUser) return;
    
    const newRecipientId = parseInt(clickedUser.dataset.id, 10);
    const newUsername = clickedUser.dataset.username;
    
    console.log('Switching to chat with:', newRecipientId, typeof newRecipientId);
    
    if (newRecipientId === activeChatRecipientId) {
        console.log('Same chat, ignoring');
        return;
    }
    
    if (activeUserItem) {
        activeUserItem.classList.remove('active');
    }
    
    activeChatRecipientId = newRecipientId;
    console.log('activeChatRecipientId set to:', activeChatRecipientId, typeof activeChatRecipientId);
    
    activeUserItem = clickedUser;
    activeUserItem.classList.add('active');
    chatTitle.innerText = 'Чат з: ' + newUsername;
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
}

// ===== MESSAGES =====
function renderChatHistory(history) {
    messages.innerHTML = '';
    if (history.length === 0) {
        messages.innerHTML = '<li class="status">Повідомлень ще немає.</li>';
        return;
    }
    for (const msg of history) {
        renderMessage(msg, false);
    }
    scrollToBottom();
}

function renderMessage(msgData, shouldScroll = true) {
    const item = document.createElement('li');
    item.dataset.messageId = msgData.id;
    const timestamp = new Date(msgData.timestamp);
    const formattedTime = timestamp.toLocaleString('uk-UA', {
        hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: 'short'
    });

    if (msgData.sender_id === currentUserId) {
        item.classList.add('my-message');
    }
    
    let messageContent = '';
    switch(msgData.media_type) {
        case 'image':
            messageContent = `<img src="${msgData.media_url}" alt="Зображення" class="chat-image">`;
            break;
        case 'gif':
            messageContent = `<img src="${msgData.media_url || msgData.text}" alt="GIF" class="chat-image">`;
            break;
        case 'video':
            messageContent = `<video src="${msgData.media_url}" class="chat-video" controls></video>`;
            break;
        case 'text':
        default:
            messageContent = msgData.text || "";
    }
    
    let readStatus = '';
    if (msgData.sender_id === currentUserId) {
        const readClass = msgData.is_read ? 'read' : '';
        readStatus = `<span class="read-status ${readClass}">${msgData.is_read ? '✓✓' : '✓'}</span>`;
    }

    item.innerHTML = `
        ${messageContent}
        <span class="timestamp">
            ${formattedTime}
            ${readStatus}
        </span>
    `;
    messages.appendChild(item);
    if (shouldScroll) {
        scrollToBottom();
    }
}

function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

function sendMessage() {
    const text = input.value.trim();
    if (!text || !activeChatRecipientId) {
        console.log('Cannot send: text or recipient missing', text, activeChatRecipientId);
        return;
    }
    
    console.log('Sending message to:', activeChatRecipientId, typeof activeChatRecipientId);
    
    let payload = {
        'text': null,
        'media_url': null,
        'media_type': 'text',
        'recipient_id': activeChatRecipientId
    };

    if (text.startsWith('http') && (text.endsWith('.gif') || text.endsWith('.gifv') || text.includes('tenor.com/view') || text.includes('giphy.com/media'))) {
        payload.media_type = 'gif';
        payload.media_url = text;
    } else {
        payload.media_type = 'text';
        payload.text = text;
    }
    
    socket.emit('send_message', payload);
    input.value = "";
}

function handleInputKeypress(e) {
    if (e.key === 'Enter') sendMessage();
}

// ===== FILE UPLOAD =====
function uploadFile(file) {
    if (!file || !activeChatRecipientId) return;
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('recipient_id', activeChatRecipientId);
    
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    let text = "<i>Завантаження файлу...</i>";
    if (isImage) text = "<i>Завантаження фото...</i>";
    if (isVideo) text = "<i>Завантаження відео...</i>";
    
    renderMessage({
        sender_id: currentUserId, text: text,
        media_type: 'text', timestamp: new Date().toISOString()
    }, true);
    
    fetch('/upload', { method: 'POST', body: formData })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('Upload success');
        } else {
            alert('Помилка завантаження: ' + data.error);
        }
    })
    .catch(error => console.error('Fetch error:', error));
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        uploadFile(file);
    }
    e.target.value = null;
}

// ===== GIF MODAL =====
function openGifModal() {
    if (gifButton.disabled) return;
    gifLibrary.innerHTML = '<span class="status">Завантаження GIF...</span>';
    gifModal.classList.add('modal-visible');
    socket.emit('load_my_gifs');
}

function closeGifModal() {
    gifModal.classList.remove('modal-visible');
}

function handleModalClick(e) {
    if (e.target === gifModal) {
        closeGifModal();
    }
}

function handleGifSelect(e) {
    if (e.target.tagName === 'IMG') {
        const gifUrl = e.target.src;
        socket.emit('send_message', {
            'text': null,
            'media_url': gifUrl,
            'media_type': 'gif',
            'recipient_id': activeChatRecipientId
        });
        closeGifModal();
    }
}

// ===== UTILITIES =====
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

// ===== SOCKET.IO HANDLERS =====
socket.on('connect', function() {
    console.log('Socket connected');
});

socket.on('disconnect', function() {
    console.log('Socket disconnected');
});

socket.on('users_list', function(data) {
    renderUserList(data.users, data.online_ids);
});

socket.on('new_message', function(data) {
    console.log('Received new_message:', data);
    
    const senderId = parseInt(data.sender_id, 10);
    const recipientId = parseInt(data.recipient_id, 10);
    
    let chatPartnerId;
    if (senderId === currentUserId) {
        chatPartnerId = recipientId;
    } else {
        chatPartnerId = senderId;
    }
    
    console.log('Message chatPartnerId:', chatPartnerId, 'activeChatRecipientId:', activeChatRecipientId);
    
    if (!chatHistories[chatPartnerId]) {
        chatHistories[chatPartnerId] = [];
    }
    chatHistories[chatPartnerId].push(data);
    
    if (chatPartnerId === activeChatRecipientId) {
        console.log('Message is for active chat, rendering');
        if (messages.querySelector('.status')) {
            messages.innerHTML = '';
        }
        renderMessage(data, true);
        if (senderId !== currentUserId) {
            socket.emit('mark_as_read', { 'chat_partner_id': senderId });
        }
    } else {
        console.log('Message is NOT for active chat');
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
    console.log('History loaded for:', partnerId, 'activeChatRecipientId:', activeChatRecipientId);
    
    chatHistories[partnerId] = data.history;
    
    if (partnerId === activeChatRecipientId) {
        renderChatHistory(data.history);
    }
});

socket.on('messages_were_read', function(data) {
    const partnerId = parseInt(data.reader_id, 10);
    
    if (chatHistories[partnerId]) {
        chatHistories[partnerId].forEach(msg => {
            if (data.message_ids.includes(msg.id)) {
                msg.is_read = true;
            }
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

socket.on('user_status_change', function(data) {
    const userId = parseInt(data.user_id, 10);
    const userItem = findUserListItem(userId);
    if (!userItem) return;
    const lastSeenEl = userItem.querySelector('.last-seen');
    if (data.status === 'online') {
        userItem.classList.add('online');
        lastSeenEl.innerText = 'Онлайн';
    } else {
        userItem.classList.remove('online');
        if (allUsers[userId]) {
            allUsers[userId].last_seen = data.last_seen;
        }
        lastSeenEl.innerText = formatLastSeen(data.last_seen);
    }
});

socket.on('my_gifs_loaded', function(data) {
    if (data.gifs.length === 0) {
        gifLibrary.innerHTML = '<span class="status">Ви ще не відправляли GIF.</span>';
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

// ===== ЗАПУСК =====
document.addEventListener('DOMContentLoaded', init);