# app/__init__.py
from flask import Flask
from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from config import Config

# Ініціалізуємо розширення тут
socketio = SocketIO() # <-- ЗМІНА
db = SQLAlchemy()
login = LoginManager()
login.login_view = 'main.login'
login.login_message = 'Будь ласка, увійдіть, щоб побачити цю сторінку.'


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Ініціалізуємо розширення з 'app'
    socketio.init_app(app, async_mode='eventlet') # <-- ЗМІНА
    db.init_app(app)
    login.init_app(app)

    # --- Реєстрація компонентів ---
    from .routes import main as main_blueprint
    app.register_blueprint(main_blueprint)

    from . import models 
    from . import events 

    with app.app_context():
        db.create_all() 

    print("Додаток 'Synaps' успішно створено з Cloudinary.")
    return app