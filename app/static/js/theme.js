// ===== THEME MANAGEMENT =====

// Отримуємо збережену тему або системну
function getInitialTheme() {
    const savedTheme = localStorage.getItem('synaps-theme');
    if (savedTheme) {
        return savedTheme;
    }
    
    // Перевіряємо системні налаштування
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    
    return 'light';
}

// Встановлюємо тему
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('synaps-theme', theme);
    
    // Оновлюємо meta theme-color для мобільних браузерів
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
    }
    
    const themeColors = {
        light: '#ffffff',
        dark: '#1a1a1a'
    };
    
    document.querySelector('meta[name="theme-color"]').setAttribute('content', themeColors[theme]);
}

// Перемикаємо тему
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

// Ініціалізація
document.addEventListener('DOMContentLoaded', function() {
    // Встановлюємо початкову тему
    const initialTheme = getInitialTheme();
    setTheme(initialTheme);
    
    // Додаємо обробник на кнопку
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Слухаємо зміни системної теми
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            // Змінюємо тему тільки якщо користувач не встановив власну
            if (!localStorage.getItem('synaps-theme')) {
                setTheme(e.matches ? 'dark' : 'light');
            }
        });
    }
});