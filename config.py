# config.py
import os
import sqlalchemy.pool
import cloudinary # <-- НОВИЙ ІМПОРТ

# Визначаємо базову директорію
basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'bA4vLpQ8tZ1fE2cK7jR9sW_uX3gY6mN'
    
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, 'app', 'synaps.db')
        
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    SQLALCHEMY_ENGINE_OPTIONS = {
        "poolclass": sqlalchemy.pool.NullPool
    }
    
    # === НОВИЙ БЛОК: НАЛАШТУВАННЯ CLOUDINARY ===
    # Ми читаємо ключі з середовища, які ти додав в Render
    cloudinary.config(
        cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME'),
        api_key = os.environ.get('CLOUDINARY_API_KEY'),
        api_secret = os.environ.get('CLOUDINARY_API_SECRET')
    )