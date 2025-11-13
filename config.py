# config.py
import os
import sqlalchemy.pool # <-- НОВИЙ ІМПОРТ

# Визначаємо базову директорію
basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    """Клас конфігурації для нашого додатка."""
    
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'bA4vLpQ8tZ1fE2cK7jR9sW_uX3gY6mN'
    
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, 'app', 'synaps.db')
        
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # === ОСЬ НОВИЙ, ПРАВИЛЬНИЙ ФІКС ДЛЯ RENDER ===
    # Ми кажемо SQLAlchemy НЕ використовувати пул з'єднань (pooling),
    # а створювати і закривати з'єднання кожного разу.
    # Це повністю вирішує конфлікт між eventlet та SQLAlchemy
    # на Render.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "poolclass": sqlalchemy.pool.NullPool
    }