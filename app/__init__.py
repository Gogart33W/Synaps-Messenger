# app/__init__.py
from flask import Flask
from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from config import Config

# Створюємо екземпляри розширень тут, щоб
# інші файли могли їх імпортувати
socketio = SocketIO()
db = SQLAlchemy()
login = LoginManager()

# Це каже Flask-Login: "Якщо хтось спробує зайти
# на сторінку, куди потрібен логін, перекинь його
# на сторінку 'main.login'"
login.login_view = 'main.login'
login.login_message = 'Будь ласка, увійдіть, щоб побачити цю сторінку.'


def create_app(config_class=Config):
    """
    Фабрика для створення екземпляра нашого Flask-додатку.
    """
    app = Flask(__name__)
    
    # 1. Завантажуємо конфігурацію з класу Config
    # Це має відбутися ПЕРЕД ініціалізацією розширень
    app.config.from_object(config_class)

    # 2. Ініціалізуємо розширення з нашим 'app'
    socketio.init_app(app)
    db.init_app(app)
    login.init_app(app)

    # --- Реєстрація компонентів додатку ---

    # 1. Реєструємо Blueprint з веб-маршрутами
    from .routes import main as main_blueprint
    app.register_blueprint(main_blueprint)

    # 2. Імпортуємо моделі (щоб db.create_all знав про них)
    from . import models 
    
    # 3. Імпортуємо обробники подій Socket.IO
    from . import events 

    # Створюємо таблиці в базі даних (якщо їх ще немає)
    # Ми робимо це тут, бо моделі вже імпортовані
    with app.app_context():
        db.create_all() 

    print("Додаток 'Synaps' успішно створено з базою даних та логіном.")
    return app