// Profile page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const avatarInput = document.getElementById('avatar-input');
    const avatarPreview = document.getElementById('avatar-preview');
    const avatarPlaceholder = document.querySelector('.avatar-placeholder');
    const container = document.querySelector('.avatar-upload-container');
    
    if (avatarInput) {
        avatarInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            // Перевіряємо розмір (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert('Файл занадто великий! Максимум 5MB');
                return;
            }
            
            // Перевіряємо тип
            if (!file.type.startsWith('image/')) {
                alert('Можна завантажувати тільки зображення!');
                return;
            }
            
            // Показуємо превью
            const reader = new FileReader();
            reader.onload = function(e) {
                if (avatarPreview) {
                    avatarPreview.src = e.target.result;
                } else if (avatarPlaceholder) {
                    // Замінюємо placeholder на img
                    const img = document.createElement('img');
                    img.id = 'avatar-preview';
                    img.src = e.target.result;
                    img.alt = 'Avatar';
                    avatarPlaceholder.replaceWith(img);
                }
            };
            reader.readAsDataURL(file);
            
            // Завантажуємо на сервер
            uploadAvatar(file);
        });
    }
    
    function uploadAvatar(file) {
        const formData = new FormData();
        formData.append('avatar', file);
        
        // Показуємо індикатор завантаження
        container.classList.add('avatar-uploading');
        
        fetch('/upload_avatar', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            container.classList.remove('avatar-uploading');
            
            if (data.success) {
                // Успіх!
                console.log('Avatar uploaded:', data.avatar_url);
                
                // Показуємо повідомлення
                showNotification('Аватар оновлено!', 'success');
            } else {
                alert('Помилка завантаження: ' + data.error);
            }
        })
        .catch(error => {
            container.classList.remove('avatar-uploading');
            console.error('Upload error:', error);
            alert('Помилка завантаження аватара');
        });
    }
    
    function showNotification(message, type = 'info') {
        // Створюємо повідомлення
        const notification = document.createElement('div');
        notification.className = 'flash-message';
        notification.innerHTML = `
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>
            <span>${message}</span>
        `;
        
        // Додаємо в контейнер
        let flashContainer = document.querySelector('.flash-container');
        if (!flashContainer) {
            flashContainer = document.createElement('div');
            flashContainer.className = 'flash-container';
            document.body.appendChild(flashContainer);
        }
        
        flashContainer.appendChild(notification);
        
        // Видаляємо через 3 секунди
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
});