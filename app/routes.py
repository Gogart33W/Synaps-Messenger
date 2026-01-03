# app/routes.py
from flask import render_template, redirect, url_for, flash, Blueprint, request, jsonify, current_app
from flask_login import login_user, logout_user, current_user, login_required
import cloudinary.uploader
from datetime import datetime, timezone
from sqlalchemy import func

from . import db, login, socketio
from .forms import LoginForm, RegistrationForm
from .models import User, Message, Favorite

main = Blueprint('main', __name__)

@login.user_loader
def load_user(id):
    return User.query.get(int(id))

@main.route('/')
@main.route('/index')
@login_required
def index():
    giphy_key = current_app.config.get('GIPHY_API_KEY', 'dc6zaTOxFJmzC')
    return render_template('index.html', giphy_key=giphy_key)

@main.route('/upload_avatar', methods=['POST'])
@login_required
def upload_avatar():
    if 'avatar' not in request.files:
        return jsonify({'success': False, 'error': 'Файл не знайдено'}), 400
    
    file = request.files['avatar']
    try:
        # Просте завантаження без зайвих налаштувань для швидкості
        upload_result = cloudinary.uploader.upload(
            file,
            folder="avatars",
            transformation=[{"width": 200, "height": 200, "crop": "limit"}]
        )
        
        current_user.avatar_url = upload_result.get('secure_url')
        db.session.commit()
        return jsonify({'success': True, 'avatar_url': current_user.avatar_url})
    except Exception as e:
        print(f"!!! Cloudinary Error: {str(e)}")
        return jsonify({'success': False, 'error': "Сервер не зміг з'єднатися з хмарою. Спробуйте ще раз."}), 500

@main.route('/profile')
@login_required
def profile():
    return render_template('profile.html', user=current_user)

@main.route('/update_profile', methods=['POST'])
@login_required
def update_profile():
    data = request.form
    current_user.display_name = data.get('display_name', '').strip() or current_user.display_name
    current_user.bio = data.get('bio', '').strip() or None
    try:
        db.session.commit()
        flash('Профіль оновлено!')
    except:
        db.session.rollback()
    return redirect(url_for('main.profile'))

@main.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('main.index'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=form.remember_me.data)
            return redirect(url_for('main.index'))
    return render_template('login.html', form=form)

@main.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated: return redirect(url_for('main.index'))
    form = RegistrationForm()
    if form.validate_on_submit():
        user = User(username=form.username.data)
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        return redirect(url_for('main.login'))
    return render_template('register.html', form=form)

@main.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('main.login'))