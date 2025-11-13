# app/routes.py

# Імпорти з Flask та розширень
from flask import render_template, redirect, url_for, flash, Blueprint
from flask_login import login_user, logout_user, current_user, login_required

# Імпорти з нашого 'app'
from . import db, login  
from .forms import LoginForm, RegistrationForm
from .models import User

# Створюємо 'main' (Blueprint)
main = Blueprint('main', __name__)


# Цей 'loader' потрібен Flask-Login, щоб знати, як отримати юзера по ID
@login.user_loader
def load_user(id):
    return User.query.get(int(id))


# === ОНОВЛЕНА ГОЛОВНА СТОРІНКА ===
@main.route('/')
@main.route('/index')
@login_required  # Захищаємо сторінку
def index():
    """
    Головна сторінка (чат). 
    Тепер вона також завантажує список всіх інших користувачів.
    """
    # === НОВА ЛОГІКА ===
    # 1. Дістаємо всіх юзерів з БД, 
    # 2. ...ОКРІМ поточного (щоб не бачити себе у списку)
    users = User.query.filter(User.id != current_user.id).all()
    
    # 3. Передаємо цей список у наш HTML-шаблон
    return render_template('index.html', users=users) 


# === МАРШРУТИ АВТЕНТИФІКАЦІЇ ===

@main.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        
        if user is None or not user.check_password(form.password.data):
            flash('Неправильне ім\'я користувача або пароль')
            return redirect(url_for('main.login'))
        
        login_user(user, remember=form.remember_me.data)
        flash('Вхід успішний!')
        return redirect(url_for('main.index'))
        
    return render_template('login.html', form=form)


@main.route('/logout')
def logout():
    logout_user()
    flash('Ви вийшли з акаунту.')
    return redirect(url_for('main.login'))


@main.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
        
    form = RegistrationForm()
    if form.validate_on_submit():
        user = User(username=form.username.data)
        user.set_password(form.password.data)
        
        db.session.add(user)
        db.session.commit()
        
        flash('Вітаємо, ви успішно зареєструвалися!')
        return redirect(url_for('main.login'))
        
    return render_template('register.html', form=form)