# config.py
import os
import sqlalchemy.pool
import cloudinary
from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY')
    GIPHY_API_KEY = os.environ.get('GIPHY_API_KEY')
    
    # Отримуємо посилання від Render
    db_url = os.environ.get('DATABASE_URL')
    
    # Авто-виправлення формату для SQLAlchemy 2.0+
    if db_url:
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        # Прибираємо зайві параметри, якщо вони є
        if "?" in db_url and "sslmode=" not in db_url:
            db_url += "&sslmode=require"
        elif "?" not in db_url:
            db_url += "?sslmode=require"
        
    SQLALCHEMY_DATABASE_URI = db_url or \
        'sqlite:///' + os.path.join(basedir, 'app', 'synaps.db')
        
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # NullPool важливо для роботи з "Pooler" від Supabase
    SQLALCHEMY_ENGINE_OPTIONS = { "poolclass": sqlalchemy.pool.NullPool }
    
    cloudinary.config(
        cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME'),
        api_key = os.environ.get('CLOUDINARY_API_KEY'),
        api_secret = os.environ.get('CLOUDINARY_API_SECRET')
    )