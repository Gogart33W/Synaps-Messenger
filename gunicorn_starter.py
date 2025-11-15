# gunicorn_starter.py
import eventlet
eventlet.monkey_patch()

# Запускаємо скрипт ініціалізації БД
import subprocess
import sys

print("🔧 Running database initialization...")
result = subprocess.run([sys.executable, 'init_db.py'], capture_output=True, text=True)
print(result.stdout)
if result.stderr:
    print(result.stderr)

# Імпортуємо додаток
from app import create_app, socketio
app = create_app()