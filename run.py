# run.py
import eventlet
# Це МАЄ бути найпершим рядком, до будь-яких інших імпортів!
eventlet.monkey_patch()

from app import create_app, socketio

app = create_app()

if __name__ == '__main__':
    print("Запускаємо сервер...")
    socketio.run(app, 
                 host='0.0.0.0', 
                 port=5000, 
                 debug=True
                )