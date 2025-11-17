# app/__init__.py
from flask import Flask
from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_migrate import Migrate
from config import Config

socketio = SocketIO()
db = SQLAlchemy()
login = LoginManager()
login.login_view = 'main.login'
login.login_message = 'Будь ласка, увійдіть, щоб побачити цю сторінку.'

migrate = Migrate()

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # === БУЛО: async_mode='eventlet' ===
    # === СТАЛО: async_mode='gevent'  ===
    socketio.init_app(app, async_mode='gevent') 
    
    db.init_app(app)
    login.init_app(app)
    migrate.init_app(app, db)

    from .routes import main as main_blueprint
    app.register_blueprint(main_blueprint)

    from . import models 
    from . import events 
    
    print("Додаток 'Synaps' успішно створено (gevent mode).")
    return app