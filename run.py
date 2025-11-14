# run.py
# !!! МИ ПРИБРАЛИ ЗВІДСИ eventlet.monkey_patch() !!!

from app import create_app, socketio

# Створюємо 'app' на глобальному рівні
app = create_app()

if __name__ == '__main__':
    # 'socketio.run' сам підхопить eventlet, якщо він встановлений
    print("Запускаємо локальний dev-сервер...")
    socketio.run(app, 
                 host='0.0.0.0', 
                 port=5000, 
                 debug=True
                )