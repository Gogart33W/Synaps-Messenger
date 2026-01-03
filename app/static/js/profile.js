// app/static/js/profile.js

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
            
            // Показуємо превью локально відразу
            const reader = new FileReader();
            reader.onload = function(e) {
                if (avatarPreview) {
                    avatarPreview.src = e.target.result;
                } else if (avatarPlaceholder) {
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
        
        // Додаємо клас завантаження
        container.classList.add('avatar-uploading');
        
        fetch('/upload_avatar', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) throw new Error('Помилка сервера');
            return response.json();
        })
        .then(data => {
            container.classList.remove('avatar-uploading');
            
            if (data.success) {
                console.log('Avatar uploaded:', data.avatar_url);
                showNotification('Аватар оновлено!', 'success');
            } else {
                alert('Помилка завантаження: ' + (data.error || 'Невідома помилка'));
                location.reload(); // Перезавантажуємо, щоб скинути превью
            }
        })
        .catch(error => {
            container.classList.remove('avatar-uploading');
            console.error('Upload error:', error);
            alert('Помилка зв\'язку із сервером. Перевірте консоль.');
            location.reload();
        });
    }
    
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = 'flash-message';
        notification.innerHTML = `<span>${message}</span>`;
        
        let flashContainer = document.querySelector('.flash-container');
        if (!flashContainer) {
            flashContainer = document.createElement('div');
            flashContainer.className = 'flash-container';
            document.body.appendChild(flashContainer);
        }
        
        flashContainer.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
});