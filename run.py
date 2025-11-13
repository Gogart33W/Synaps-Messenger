# run.py
from app import create_app, socketio

# === ВАЖЛИВА ЗМІНА ===
# Ми створюємо 'app' тут, на глобальному рівні,
# щоб Gunicorn (сервер на Render) міг його знайти.
app = create_app()


if __name__ == '__main__':
    # Цей 'if' тепер буде запускатись ТІЛЬКИ 
    # коли ми робимо 'python run.py' (локально)
    # Gunicorn НЕ буде запускати цей блок.
    
    # Ми явно імпортуємо eventlet для локального тестування
    # (хоча gunicorn буде використовувати його на сервері)
    import eventlet
    
    print("Запускаємо локальний dev-сервер...")
    socketio.run(app, 
                 host='0.0.0.0', 
                 port=5000, 
                 debug=True
                )