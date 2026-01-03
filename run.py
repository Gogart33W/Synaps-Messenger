import eventlet
# ЦЕ МАЄ БУТИ НАЙПЕРШИМ РЯДКОМ! Без цього будуть помилки 500.
eventlet.monkey_patch()

from app import create_app, socketio, db
from flask_migrate import upgrade

app = create_app()

if __name__ == '__main__':
    with app.app_context():
        try:
            print("Виконуємо міграції бази даних...")
            upgrade()
            print("Міграції успішно застосовані.")
        except Exception as e:
            print(f"Помилка під час міграції: {e}")

    print("Запускаємо сервер...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)