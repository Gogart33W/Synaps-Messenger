# config.py
import os
import sqlalchemy.pool
import cloudinary
from dotenv import load_dotenv # <-- НОВИЙ ІМПОРТ

# Визначаємо базову директорію
basedir = os.path.abspath(os.path.dirname(__file__))

# === НОВА ЛОГІКА ===
# Завантажуємо змінні з .env файлу (тільки для локального запуску)
load_dotenv(os.path.join(basedir, '.env'))


class Config:
    # Тепер він шукає ключ 1) на Render, 2) в .env, і 3) НЕ хардкодить нічого
    SECRET_KEY = os.environ.get('SECRET_KEY')
    
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, 'app', 'synaps.db')
        
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    SQLALCHEMY_ENGINE_OPTIONS = {
        "poolclass": sqlalchemy.pool.NullPool
    }
    
    cloudinary.config(
        cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME'),
        api_key = os.environ.get('CLOUDINARY_API_KEY'),
        api_secret = os.environ.get('CLOUDINARY_API_SECRET')
    )