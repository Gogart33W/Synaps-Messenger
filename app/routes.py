# app/routes.py
from flask import render_template, redirect, url_for, flash, Blueprint, request, jsonify
from flask_login import login_user, logout_user, current_user, login_required
import cloudinary.uploader # <-- НОВИЙ ІМПОРТ

from . import db, login, socketio # <-- ДОДАНО socketio
from .forms import LoginForm, RegistrationForm
from .models import User, Message # <-- ДОДАНО Message

main = Blueprint('main', __name__)

@login.user_loader
def load_user(id):
    return User.query.get(int(id))

@main.route('/')
@main.route('/index')
@login_required
def index():
    users = User.query.filter(User.id != current_user.id).all()
    return render_template('index.html', users=users) 

# === НОВИЙ МАРШРУТ ДЛЯ ЗАВАНТАЖЕННЯ ФАЙЛІВ ===
@main.route('/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
        
    file = request.files['file']
    recipient_id = request.form.get('recipient_id')
    
    if file.filename == '' or not recipient_id:
        return jsonify({"error": "No selected file or recipient"}), 400

    try:
        # 1. Завантажуємо файл на Cloudinary
        upload_result = cloudinary.uploader.upload(file)
        
        # 2. Отримуємо безпечну URL
        image_url = upload_result.get('secure_url')
        if not image_url:
             return jsonify({"error": "Upload failed"}), 500
        
        # 3. Зберігаємо в нашу БД
        new_message = Message(
            sender_id=current_user.id,
            recipient_id=int(recipient_id),
            image_url=image_url,
            is_image=True,
            text=None
        )
        db.session.add(new_message)
        db.session.commit()

        # 4. Надсилаємо по WebSockets
        message_data = new_message.to_dict()
        socketio.emit('new_message', message_data, room=int(recipient_id))
        socketio.emit('new_message', message_data, room=current_user.id)

        return jsonify({"success": True, "data": message_data}), 200

    except Exception as e:
        print(f"Error uploading file: {e}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
        

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