import eventlet
# Важливо: patch_all має бути на самому початку
eventlet.monkey_patch()

from app import create_app, socketio, db
from flask_migrate import upgrade
import os

app = create_app()

if __name__ == '__main__':
    with app.app_context():
        try:
            print("Перевірка бази даних...")
            upgrade()
        except Exception as e:
            print(f"Міграція пропущена або помилка: {e}")

    port = int(os.environ.get('PORT', 5000))
    print(f"Синапс запускається на порту {port}...")
    socketio.run(app, host='0.0.0.0', port=port, debug=False)