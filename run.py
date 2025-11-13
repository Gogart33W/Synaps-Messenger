# run.py

# === ГОЛОВНИЙ ФІКС ===
# eventlet.monkey_patch() має бути викликаний
# ДО імпорту ЛЮБИХ інших бібліотек (особливо flask, sqlalchemy, socketio)
# Це "озеленює" стандартні бібліотеки Python, щоб вони не 
# конфліктували з SQLAlchemy у Gunicorn.
import eventlet
eventlet.monkey_patch()

# Тепер, коли все "озеленено", ми можемо безпечно імпортувати решту
from app import create_app, socketio

# Створюємо 'app' на глобальному рівні, щоб Gunicorn міг його знайти
app = create_app()

if __name__ == '__main__':
    # Цей блок тепер запускається ТІЛЬКИ локально
    print("Запускаємо локальний dev-сервер...")
    
    # 'socketio.run' автоматично використає eventlet, бо ми його за-patch-или
    socketio.run(app, 
                 host='0.0.0.0', 
                 port=5000, 
                 debug=True
                )