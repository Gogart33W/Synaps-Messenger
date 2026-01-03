// app/static/js/profile.js
document.addEventListener('DOMContentLoaded', function() {
    const avatarInput = document.getElementById('avatar-input');
    const container = document.querySelector('.avatar-upload-container');

    if (avatarInput) {
        avatarInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('avatar', file);
            container.classList.add('avatar-uploading');

            // Таймаут на 20 секунд для анімації
            const timeout = setTimeout(() => {
                container.classList.remove('avatar-uploading');
            }, 20000);

            fetch('/upload_avatar', { method: 'POST', body: formData })
                .then(r => r.json())
                .then(data => {
                    clearTimeout(timeout);
                    container.classList.remove('avatar-uploading');
                    if (data.success) {
                        location.reload();
                    } else {
                        alert("Помилка: " + data.error);
                    }
                })
                .catch(() => {
                    clearTimeout(timeout);
                    container.classList.remove('avatar-uploading');
                    alert("Мережева помилка. Спробуйте інше фото або пізніше.");
                });
        });
    }
});