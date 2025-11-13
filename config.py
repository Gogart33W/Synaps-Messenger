# config.py
import os

# Визначаємо базову директорію
basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    """Клас конфігурації для нашого додатка."""
    
    # Render сам надасть нам цей ключ
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'bA4vLpQ8tZ1fE2cK7jR9sW_uX3gY6mN'
    
    # Ми пріоритетно шукаємо 'DATABASE_URL', яку нам дасть Render.
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, 'app', 'synaps.db')
        
    # Це вимикає сповіщення SQLAlchemy, які нам не потрібні
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # === ОСЬ ГОЛОВНИЙ ФІКС ДЛЯ RENDER ===
    # Цей параметр каже SQLAlchemy (і драйверу psycopg2)
    # бути "дружніми" до eventlet (використовувати greenlets),
    # що виправляє помилку "cannot notify on un-acquired lock".
    SQLALCHEMY_ENGINE_OPTIONS = {
        "connect_args": {"use_greenlets": True}
    }