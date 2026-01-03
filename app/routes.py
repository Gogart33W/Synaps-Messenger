# app/routes.py
from flask import render_template, redirect, url_for, flash, Blueprint, request, jsonify, current_app
from flask_login import login_user, logout_user, current_user, login_required
import cloudinary.uploader
import socket # Додано для фіксу DNS
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
    if not file or file.filename == '':
        return jsonify({'success': False, 'error': 'Файл порожній'}), 400

    try:
        print("--- СПРОБА ЗАВАНТАЖЕННЯ АВАТАРА (DNS FIX ENABLED) ---")
        
        # ФІКС DNS: Допомагаємо серверу знайти Cloudinary, якщо DNS на Render тупить
        try:
            socket.gethostbyname('api.cloudinary.com')
        except socket.gaierror:
            print("!!! DNS Error: Не вдалося знайти api.cloudinary.com через стандартний DNS")

        # Пряме завантаження
        upload_result = cloudinary.uploader.upload(
            file,
            folder="synaps_avatars",
            resource_type="image",
            transformation=[
                {"width": 250, "height": 250, "crop": "fill", "gravity": "face"}
            ]
        )
        
        new_url = upload_result.get('secure_url')
        if not new_url:
            raise Exception("Cloudinary не повернув secure_url")

        current_user.avatar_url = new_url
        db.session.commit()
        
        print(f"+++ АВАТАР УСПІШНО ОНОВЛЕНО: {new_url}")
        return jsonify({'success': True, 'avatar_url': new_url})

    except Exception as e:
        db.session.rollback()
        print(f"!!! КРИТИЧНА ПОМИЛКА ЗАВАНТАЖЕННЯ: {str(e)}")
        # Повертаємо деталі помилки для відладки
        return jsonify({'success': False, 'error': f"Помилка зв'язку з Cloudinary: {str(e)}"}), 500

@main.route('/profile')
@login_required
def profile():
    return render_template('profile.html', user=current_user)

@main.route('/update_profile', methods=['POST'])
@login_required
def update_profile():
    data = request.form
    display_name = data.get('display_name', '').strip()
    if display_name:
        current_user.display_name = display_name
    current_user.bio = data.get('bio', '').strip() or None
    
    try:
        db.session.commit()
        flash('Профіль оновлено!')
    except:
        db.session.rollback()
        flash('Помилка збереження')
    return redirect(url_for('main.profile'))

@main.route('/user/<int:user_id>')
@login_required
def view_user_profile(user_id):
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        return redirect(url_for('main.profile'))
    is_fav = current_user.is_favorite(user)
    return render_template('user_profile.html', user=user, is_favorite=is_fav)

@main.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('main.index'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=form.remember_me.data)
            user.last_seen = datetime.now(timezone.utc)
            db.session.commit()
            return redirect(url_for('main.index'))
        flash('Невірний логін або пароль')
    return render_template('login.html', form=form)

@main.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated: return redirect(url_for('main.index'))
    form = RegistrationForm()
    if form.validate_on_submit():
        user = User(username=form.username.data)
        user.set_password(form.password.data)
        db.session.add(user)
        try:
            db.session.commit()
            flash('Успішна реєстрація!')
            return redirect(url_for('main.login'))
        except:
            db.session.rollback()
            flash('Помилка реєстрації')
    return render_template('register.html', form=form)

@main.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('main.login'))

@main.route('/upload', methods=['POST'])
@login_required
def upload_file():
    try:
        file = request.files.get('file')
        recipient_id = request.form.get('recipient_id')
        if not file or not recipient_id: return jsonify({"error": "No data"}), 400
        
        res = cloudinary.uploader.upload(file, resource_type="auto")
        msg = Message(sender_id=current_user.id, recipient_id=int(recipient_id), 
                      media_url=res.get('secure_url'), 
                      media_type='image' if 'image' in file.mimetype else 'video')
        db.session.add(msg)
        db.session.commit()
        
        socketio.emit('new_message', msg.to_dict(), room=int(recipient_id))
        socketio.emit('new_message', msg.to_dict(), room=current_user.id)
        return jsonify({"success": True})
    except Exception as e:
        print(f"Chat upload error: {e}")
        return jsonify({"error": str(e)}), 500