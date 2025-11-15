// ===== ГЛОБАЛЬНІ ЗМІННІ =====
const chatHistories = {};
const unreadCounts = {};
const allUsers = {};
const online_users = new Set(); // Глобальний сет ID онлайн-юзерів

// Tenor API Key (безкоштовний!)
const TENOR_API_KEY = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ'; // Публічний ключ
const TENOR_CLIENT_KEY = 'synaps_messenger';

const wrapper = document.getElementById('content-wrapper');
const currentUserId = parseInt(wrapper.dataset.currentUserId, 10);

let activeChatRecipientId = null;
let activeUserItem = null;
let currentGifTab = 'trending';
let searchTimeout = null; // Для "debounce" пошуку
let currentFavorites = []; // Збережемо ID обраних

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
const gifSearchInput = document.getElementById('gif-search-input');
const gifSearchButton = document.getElementById('gif-search-button');
const gifSearchContainer = document.getElementById('gif-search-container');
const userSearchInput = document.getElementById('user-search-input'); // <-- НОВИЙ

// ===== ІНІЦІАЛІЗАЦІЯ =====
function init() {
    setupEventListeners();
    setupPasteSupport();
    setupDragAndDrop();
    setupGifTabs();
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    userList.addEventListener('click', handleUserListClick); // <-- ОНОВЛЕНО
    sendButton.addEventListener('click', sendMessage);
    input.addEventListener('keypress', handleInputKeypress);
    fileInput.addEventListener('change', handleFileSelect);
    gifButton.addEventListener('click', openGifModal);
    gifCloseButton.addEventListener('click', closeGifModal);
    gifModal.addEventListener('click', handleModalClick);
    gifLibrary.addEventListener('click', handleGifSelect);
    gifSearchButton.addEventListener('click', searchGifs);
    gifSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchGifs();
    });
    userSearchInput.addEventListener('input', handleUserSearch); // <-- НОВИЙ
}

// ===== GIF TABS =====
function setupGifTabs() {
    const tabs = document.querySelectorAll('.gif-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            const tabType = this.dataset.tab;
            currentGifTab = tabType;
            
            if (tabType === 'search') {
                gifSearchContainer.style.display = 'flex';
                gifLibrary.innerHTML = '<div class="gif-loading">Введіть запит для пошуку GIF 🔍</div>';
            } else {
                gifSearchContainer.style.display = 'none';
                if (tabType === 'trending') {
                    loadTrendingGifs();
                } else if (tabType === 'my') {
                    loadMyGifs();
                }
            }
        });
    });
}

// ===== TENOR API =====
async function loadTrendingGifs() {
    gifLibrary.innerHTML = '<div class="gif-loading">Завантаження трендових GIF...</div>';
    
    try {
        const url = `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20&locale=uk_UA`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            displayGifs(data.results);
        } else {
            gifLibrary.innerHTML = '<div class="gif-error">Не вдалося завантажити GIF</div>';
        }
    } catch (error) {
        console.error('Tenor API error:', error);
        gifLibrary.innerHTML = '<div class="gif-error">Помилка завантаження GIF</div>';
    }
}

async function searchGifs() {
    const query = gifSearchInput.value.trim();
    if (!query) {
        gifLibrary.innerHTML = '<div class="gif-loading">Введіть запит для пошуку 🔍</div>';
        return;
    }
    
    gifLibrary.innerHTML = '<div class="gif-loading">Пошук GIF...</div>';
    
    try {
        const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20&locale=uk_UA`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            displayGifs(data.results);
        } else {
            gifLibrary.innerHTML = '<div class="gif-error">Нічого не знайдено 😢</div>';
        }
    } catch (error) {
        console.error('Tenor API error:', error);
        gifLibrary.innerHTML = '<div class="gif-error">Помилка пошуку GIF</div>';
    }
}

function displayGifs(results) {
    gifLibrary.innerHTML = '';
    results.forEach(gif => {
        const img = document.createElement('img');
        // Використовуємо tinygif для превью (економія трафіку)
        img.src = gif.media_formats.tinygif.url;
        // Зберігаємо повний URL в data-атрибуті
        img.dataset.gifUrl = gif.media_formats.gif.url;
        img.className = 'gif-item';
        img.alt = gif.content_description || 'GIF';
        img.loading = 'lazy';
        gifLibrary.appendChild(img);
    });
}

function loadMyGifs() {
    gifLibrary.innerHTML = '<div class="gif-loading">Завантаження ваших GIF...</div>';
    socket.emit('load_my_gifs');
}

// ===== PASTE SUPPORT =====
function setupPasteSupport() {
    input.addEventListener('paste', async function(e) {
        if (!activeChatRecipientId) return;
        
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        console.log('Paste event, items:', items.length);
        
        // Перевіряємо картинки
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
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
        
        // Перевіряємо текст (можливо це URL гіфки)
        if (items.length > 0 && items[0].type === 'text/plain') {
            items[0].getAsString(text => {
                if (isGifUrl(text)) {
                    e.preventDefault();
                    sendGif(text);
                }
            });
        }
    });
}

function isGifUrl(url) {
    return url.match(/\.(gif|gifv)$/i) || 
           url.includes('tenor.com') || 
           url.includes('giphy.com') ||
           url.includes('media.tenor.com');
}

// ===== DRAG & DROP =====
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
            uploadFile(files[0]);
        }
    });
}

// ===== USER LIST & SEARCH (НОВА ВЕРСІЯ) =====

// НОВА ФУНКЦІЯ: Обробник вводу в поле пошуку
function handleUserSearch(e) {
    const query = e.target.value.trim();
    
    // Скасовуємо попередній таймер
    clearTimeout(searchTimeout);
    
    if (!query || query.length < 2) {
        // Якщо поле порожнє, показуємо "Обраних"
        socket.emit('users_list_request'); // Попросимо сервер оновити список обраних
        return;
    }
    
    // "Debounce" - чекаємо 300мс перед відправкою запиту
    searchTimeout = setTimeout(() => {
        searchUsers(query);
    }, 300);
}

// НОВА ФУНКЦІЯ: відправки запиту на пошук
async function searchUsers(query) {
    try {
        const response = await fetch('/search_users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        });
        const data = await response.json();
        
        // Отримуємо актуальні статуси онлайн
        const onlineIds = Array.from(online_users);
        
        // Малюємо результати пошуку
        renderUserList(data.users, onlineIds, 'search');
        
    } catch (error) {
        console.error('Search error:', error);
        userList.innerHTML = '<li class="status">Помилка пошуку 😵</li>';
    }
}

// НОВА ФУНКЦІЯ: клік на "Обране"
async function handleFavoriteClick(e) {
    const btn = e.target.closest('.favorite-btn');
    if (!btn) return;
    
    e.stopPropagation(); // Зупиняємо клік, щоб не відкрити чат
    
    const userId = btn.dataset.userId;
    const isAdding = btn.classList.contains('add');
    const url = isAdding ? `/add_favorite/${userId}` : `/remove_favorite/${userId}`;
    
    try {
        const response = await fetch(url, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            // Оновлюємо кнопку
            btn.classList.toggle('add', !isAdding);
            btn.classList.toggle('remove', isAdding);
            btn.innerHTML = isAdding ? '★' : '☆';
            
            // Оновлюємо наш кеш обраних
            if (isAdding) {
                currentFavorites.push(parseInt(userId, 10));
            } else {
                currentFavorites = currentFavorites.filter(id => id !== parseInt(userId, 10));
            }
        } else {
            alert('Помилка: ' + data.error);
        }
    } catch (error) {
        console.error('Favorite toggle error:', error);
    }
}

// ПОВНІСТЮ ОНОВЛЕНА ФУНКЦІЯ: renderUserList
function renderUserList(users, onlineIds, type = 'favorites') {
    userList.innerHTML = '';
    
    if (users.length === 0) {
        let statusText = 'У вас ще немає обраних чатів. Скористайтеся пошуком.';
        if (type === 'search') {
            statusText = 'Нічого не знайдено 😢';
        }
        userList.innerHTML = `<li class="status">${statusText}</li>`;
        return;
    }
    
    users.forEach(user => {
        // Оновлюємо глобальний кеш, якщо його там ще немає
        if (!allUsers[user.id]) {
            allUsers[user.id] = user;
        }
        
        const isOnline = onlineIds.includes(user.id);
        // user.is_favorite береться з /search_users, для звичайного списку перевіряємо currentFavorites
        const isFavorite = user.is_favorite || currentFavorites.includes(user.id);
        
        const item = document.createElement('li');
        item.className = 'user-item';
        item.dataset.id = user.id;
        item.dataset.username = user.display_name; // Використовуємо display_name
        if (isOnline) item.classList.add('online');
        
        // Кнопка Додати/Видалити з обраного
        const favoriteBtn = `
            <button class="favorite-btn ${isFavorite ? 'remove' : 'add'}" data-user-id="${user.id}">
                ${isFavorite ? '★' : '☆'}
            </button>
        `;
        
        item.innerHTML = `
            <span class="status-dot"></span>
            <div class="user-info">
                <span class="username">${user.display_name}</span>
                <span class="last-seen">${isOnline ? 'Онлайн' : formatLastSeen(user.last_seen)}</span>
            </div>
            ${type === 'search' ? favoriteBtn : '<span class="unread-badge"></span>'}
        `;
        userList.appendChild(item);
        
        // Оновлюємо лічильник непрочитаних, якщо це список обраних
        if (type === 'favorites' && unreadCounts[user.id]) {
            updateUnreadCount(user.id, unreadCounts[user.id]);
        }
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
    if (badge && count > 0) {
        badge.innerText = count;
        badge.style.display = 'block';
    } else if (badge) {
        badge.style.display = 'none';
    }
}

// ПОВНІСТЮ ОНОВЛЕНА ФУНКЦІЯ: handleUserListClick
function handleUserListClick(e) {
    // 1. Перевіряємо, чи не клікнули ми на кнопку "Обране"
    const favoriteBtn = e.target.closest('.favorite-btn');
    if (favoriteBtn) {
        handleFavoriteClick(e); // Обробляємо клік на "Обране"
        return; // І виходимо
    }

    // 2. Якщо ні, то це був клік на самого юзера (стара логіка)
    const clickedUser = e.target.closest('.user-item');
    if (!clickedUser) return;
    
    requestNotificationPermission();
    
    const newRecipientId = parseInt(clickedUser.dataset.id, 10);
    const newUsername = clickedUser.dataset.username;
    
    if (newRecipientId === activeChatRecipientId) return;
    
    if (activeUserItem) activeUserItem.classList.remove('active');
    
    activeChatRecipientId = newRecipientId;
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
    
    // Якщо ми в режимі пошуку, повертаємося до списку обраних
    if (userSearchInput.value.trim().length > 0) {
        userSearchInput.value = '';
        socket.emit('users_list_request'); // Запитуємо свіжий список обраних
    }
}

// ===== MESSAGES =====
function renderChatHistory(history) {
    messages.innerHTML = '';
    if (history.length === 0) {
        messages.innerHTML = '<li class="status">Повідомлень ще немає.</li>';
        return;
    }
    history.forEach(msg => renderMessage(msg, false));
    scrollToBottom();
}

function renderMessage(msgData, shouldScroll = true) {
    const item = document.createElement('li');
    item.dataset.messageId = msgData.id;

    // ВИКОРИСТОВУЄМО НОВУ ФУНКЦІЮ ДЛЯ ЧАСУ
    const formattedTime = formatUTCToLocal(msgData.timestamp);

    if (msgData.sender_id === currentUserId) {
        item.classList.add('my-message');
    }
    
    let messageContent = '';
    switch(msgData.media_type) {
        case 'image':
        case 'gif':
            messageContent = `<img src="${msgData.media_url || msgData.text}" alt="Зображення" class="chat-image">`;
            break;
        case 'video':
            messageContent = `<video src="${msgData.media_url}" class="chat-video" controls></video>`;
            break;
        case 'text':
        default:
            // Проста санітизація, щоб уникнути XSS
            const tempDiv = document.createElement('div');
            tempDiv.innerText = msgData.text || "";
            messageContent = tempDiv.innerHTML.replace(/\n/g, '<br>');
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
    
    // Додаємо обробник для картинок, щоб відкривати їх
    const img = item.querySelector('.chat-image');
    if (img) {
        img.addEventListener('click', () => window.open(img.src, '_blank'));
    }
    
    if (shouldScroll) scrollToBottom();
}

function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

function sendMessage() {
    const text = input.value.trim();
    if (!text || !activeChatRecipientId) return;
    
    let payload = {
        'text': null,
        'media_url': null,
        'media_type': 'text',
        'recipient_id': activeChatRecipientId
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
}

function sendGif(gifUrl) {
    if (!activeChatRecipientId) return;
    
    socket.emit('send_message', {
        'text': null,
        'media_url': gifUrl,
        'media_type': 'gif',
        'recipient_id': activeChatRecipientId
    });
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
    let text = "<i>Завантаження...</i>";
    if (isImage) text = "<i>Завантаження фото...</i>";
    if (isVideo) text = "<i>Завантаження відео...</i>";
    
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

// ===== GIF MODAL =====
function openGifModal() {
    if (gifButton.disabled) return;
    gifModal.classList.add('modal-visible');
    
    // Завантажуємо тренди за замовчуванням
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
        // Використовуємо повний URL з data-атрибута або src
        const gifUrl = e.target.dataset.gifUrl || e.target.src;
        sendGif(gifUrl);
        closeGifModal();
    }
}

// ===== UTILITIES =====

// НОВА ФУНКЦІЯ для конвертації часу
function formatUTCToLocal(utcString) {
    if (!utcString) {
        return '';
    }
    try {
        const date = new Date(utcString);
        // .toLocaleString() автоматично використає часовий пояс
        // і мовні налаштування браузера користувача
        // Додаємо опції для формату, який ти використовував раніше
        return date.toLocaleString('uk-UA', {
            hour: '2-digit', minute: '2-digit',
            day: '2-digit', month: 'short'
        });
    } catch (e) {
        console.error("Error formatting date:", e);
        return utcString; // Повертаємо оригінал, якщо щось пішло не так
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

// ===== SOCKET.IO HANDLERS =====
socket.on('connect', () => console.log('Socket connected'));
socket.on('disconnect', () => console.log('Socket disconnected'));

// ОНОВЛЕНО
socket.on('users_list', data => {
    currentFavorites = data.users.map(user => user.id); // Зберігаємо ID
    
    // Очистимо і заповнимо сет онлайн-користувачів
    online_users.clear();
    data.online_ids.forEach(id => online_users.add(id));
    
    // Рендеримо, тільки якщо юзер не шукає
    if (userSearchInput.value.trim().length === 0) {
        renderUserList(data.users, data.online_ids, 'favorites');
    }
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

// ОНОВЛЕНО
socket.on('user_status_change', function(data) {
    const userId = parseInt(data.user_id, 10);
    const userItem = findUserListItem(userId);
    if (!userItem) return;
    const lastSeenEl = userItem.querySelector('.last-seen');
    if (data.status === 'online') {
        userItem.classList.add('online');
        lastSeenEl.innerText = 'Онлайн';
        online_users.add(userId); // Оновлюємо глобальний сет
    } else {
        userItem.classList.remove('online');
        if (allUsers[userId]) allUsers[userId].last_seen = data.last_seen;
        lastSeenEl.innerText = formatLastSeen(data.last_seen);
        online_users.delete(userId); // Оновлюємо глобальний сет
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

// ===== ЗАПУСК =====
document.addEventListener('DOMContentLoaded', init);