# app/routes.py
from flask import render_template, redirect, url_for, flash, Blueprint, request, jsonify
from flask_login import login_user, logout_user, current_user, login_required
import cloudinary.uploader # pyright: ignore[reportMissingImports]
from datetime import datetime, timezone
from sqlalchemy import func # <--- ОНОВЛЕНИЙ ІМПОРТ

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
    return render_template('index.html')

@main.route('/search_users', methods=['POST'])
@login_required
def search_users():
    """API для пошуку користувачів"""
    query = request.json.get('query', '').strip()
    
    if not query or len(query) < 2:
        return jsonify({'users': []})
    
    users = User.query.filter(
        db.or_(
            User.username.ilike(f'%{query}%'),
            # --- ВИПРАВЛЕНО ТУТ ---
            # func.coalesce потрібен, щоб пошук працював
            # навіть якщо display_name = NULL (як у нових юзерів)
            func.coalesce(User.display_name, '').ilike(f'%{query}%')
            # ---------------------
        ),
        User.id != current_user.id
    ).limit(20).all()
    
    results = []
    for user in users:
        user_dict = user.to_dict()
        user_dict['is_favorite'] = current_user.is_favorite(user)
        results.append(user_dict)
    
    return jsonify({'users': results})

@main.route('/user/<int:user_id>')
@login_required
def view_user_profile(user_id):
    """Перегляд профілю іншого користувача"""
    user = User.query.get_or_404(user_id)
    
    # Не дозволяємо дивитися свій власний профіль через цей роут
    if user.id == current_user.id:
        return redirect(url_for('main.profile'))
    
    return render_template('user_profile.html', user=user)

@main.route('/add_favorite/<int:user_id>', methods=['POST'])
@login_required
def add_favorite(user_id):
    """Додати користувача в обране"""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Користувач не знайдений'}), 404
    
    if user.id == current_user.id:
        return jsonify({'success': False, 'error': 'Не можна додати себе'}), 400
    
    if current_user.is_favorite(user):
        return jsonify({'success': False, 'error': 'Вже в обраному'}), 400
    
    current_user.add_favorite(user)
    db.session.commit()
    
    return jsonify({'success': True, 'user': user.to_dict()})

@main.route('/remove_favorite/<int:user_id>', methods=['POST'])
@login_required
def remove_favorite(user_id):
    """Видалити з обраного"""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Користувач не знайдений'}), 404
    
    current_user.remove_favorite(user)
    db.session.commit()
    
    return jsonify({'success': True})

@main.route('/profile')
@login_required
def profile():
    """Сторінка власного профілю"""
    return render_template('profile.html', user=current_user)

@main.route('/update_profile', methods=['POST'])
@login_required
def update_profile():
    """Оновити профіль"""
    data = request.form
    
    display_name = data.get('display_name', '').strip()
    if display_name:
        current_user.display_name = display_name
    
    bio = data.get('bio', '').strip()
    current_user.bio = bio if bio else None
    
    new_username = data.get('username', '').strip()
    if new_username and new_username != current_user.username:
        existing = User.query.filter_by(username=new_username).first()
        if existing:
            flash('Це ім\'я користувача вже зайняте')
            return redirect(url_for('main.profile'))
        current_user.username = new_username
    
    db.session.commit()
    flash('Профіль оновлено!')
    
    return redirect(url_for('main.index'))

@main.route('/upload_avatar', methods=['POST'])
@login_required
def upload_avatar():
    """Завантажити аватар"""
    if 'avatar' not in request.files:
        return jsonify({'success': False, 'error': 'No file'}), 400
    
    file = request.files['avatar']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400
    
    if not file.mimetype.startswith('image/'):
        return jsonify({'success': False, 'error': 'File must be an image'}), 400
    
    try:
        upload_result = cloudinary.uploader.upload(
            file,
            folder='avatars',
            transformation=[
                {'width': 200, 'height': 200, 'crop': 'fill', 'gravity': 'face'},
                {'quality': 'auto'}
            ]
        )
        
        avatar_url = upload_result.get('secure_url')
        if not avatar_url:
            return jsonify({'success': False, 'error': 'Upload failed'}), 500
        
        if current_user.avatar_url:
            try:
                old_public_id = current_user.avatar_url.split('/')[-1].split('.')[0]
                cloudinary.uploader.destroy(f'avatars/{old_public_id}')
            except:
                pass
        
        current_user.avatar_url = avatar_url
        db.session.commit()
        
        return jsonify({'success': True, 'avatar_url': avatar_url})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@main.route('/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    recipient_id = request.form.get('recipient_id')
    if file.filename == '' or not recipient_id:
        return jsonify({"error": "No selected file or recipient"}), 400

    file_type = 'image'
    if file.mimetype.startswith('video/'):
        file_type = 'video'
    elif file.mimetype == 'image/gif':
        file_type = 'gif'

    try:
        resource_type = 'image'
        if file_type == 'video':
             resource_type = 'video'

        upload_result = cloudinary.uploader.upload(file, resource_type=resource_type)
        media_url = upload_result.get('secure_url')
        
        if not media_url:
             return jsonify({"error": "Upload failed"}), 500
        
        new_message = Message(
            sender_id=current_user.id,
            recipient_id=int(recipient_id),
            media_url=media_url,
            media_type=file_type,
            text=None
        )
        db.session.add(new_message)
        db.session.commit()

        message_data = new_message.to_dict()
        socketio.emit('new_message', message_data, room=int(recipient_id))
        socketio.emit('new_message', message_data, room=current_user.id)
        
        socketio.emit('force_chat_list_update', room=current_user.id)
        socketio.emit('force_chat_list_update', room=int(recipient_id))
        
        return jsonify({"success": True, "data": message_data}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
        
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
        user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        flash('Вхід успішний!')
        return redirect(url_for('main.index'))
    return render_template('login.html', form=form)

@main.route('/logout')
def logout():
    if current_user.is_authenticated:
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
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
        flash('Вітаємо, ви успішно зареєструвались!')
        return redirect(url_for('main.login'))
    return render_template('register.html', form=form)