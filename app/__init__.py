# app/__init__.py
from flask import Flask
from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_migrate import Migrate # <-- НОВИЙ ІМПОРТ
from config import Config

socketio = SocketIO()
db = SQLAlchemy()
login = LoginManager()
login.login_view = 'main.login'
login.login_message = 'Будь ласка, увійдіть, щоб побачити цю сторінку.'

migrate = Migrate() # <-- НОВИЙ ОБ'ЄКТ

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    socketio.init_app(app, async_mode='eventlet')
    db.init_app(app)
    login.init_app(app)
    migrate.init_app(app, db) # <-- ІНІЦІАЛІЗУЄМО МІГРАЦІЇ

    from .routes import main as main_blueprint
    app.register_blueprint(main_blueprint)

    from . import models 
    from . import events 

    # === ВИДАЛЕНО ===
    # db.create_all() (ЦЕ БІЛЬШЕ НЕ ПОТРІБНО)
    
    print("Додаток 'Synaps' успішно створено з Migrate.")
    return app