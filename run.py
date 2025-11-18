import eventlet
# ЦЕ МАЄ БУТИ НАЙПЕРШИМ РЯДКОМ! Без цього будуть помилки 500.
eventlet.monkey_patch()

from app import create_app, socketio

app = create_app()

if __name__ == '__main__':
    print("Запускаємо сервер...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)