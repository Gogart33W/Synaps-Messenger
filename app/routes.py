# app/routes.py
from flask import render_template, redirect, url_for, flash, Blueprint, request, jsonify
from flask_login import login_user, logout_user, current_user, login_required
import cloudinary.uploader # pyright: ignore[reportMissingImports]
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
    return render_template('index.html')

@main.route('/search_users', methods=['POST'])
@login_required
def search_users():
    query = request.json.get('query', '').strip()
    
    if not query or len(query) < 2:
        return jsonify({'users': []})
    
    users = User.query.filter(
        db.or_(
            User.username.ilike(f'%{query}%'),
            func.coalesce(User.display_name, '').ilike(f'%{query}%')
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
    
    if user.id == current_user.id:
        return redirect(url_for('main.profile'))
    
    # === ВИПРАВЛЕННЯ 500 ПОМИЛКИ ===
    # Перевіряємо "вподобайку" тут, а не в шаблоні
    is_fav = current_user.is_favorite(user)
    
    return render_template('user_profile.html', user=user, is_favorite=is_fav)

@main.route('/add_favorite/<int:user_id>', methods=['POST'])
@login_required
def add_favorite(user_id):
    user = User.query.get(user_id)
    if not user: return jsonify({'success': False, 'error': 'Not found'}), 404
    if user.id == current_user.id: return jsonify({'success': False, 'error': 'Self'}), 400
    
    if not current_user.is_favorite(user):
        current_user.add_favorite(user)
        db.session.commit()
    
    return jsonify({'success': True})

@main.route('/remove_favorite/<int:user_id>', methods=['POST'])
@login_required
def remove_favorite(user_id):
    user = User.query.get(user_id)
    if not user: return jsonify({'success': False, 'error': 'Not found'}), 404
    
    current_user.remove_favorite(user)
    db.session.commit()
    
    return jsonify({'success': True})

@main.route('/profile')
@login_required
def profile():
    return render_template('profile.html', user=current_user)

@main.route('/update_profile', methods=['POST'])
@login_required
def update_profile():
    data = request.form
    display_name = data.get('display_name', '').strip()
    if display_name: current_user.display_name = display_name
    bio = data.get('bio', '').strip()
    current_user.bio = bio if bio else None
    
    new_username = data.get('username', '').strip()
    if new_username and new_username != current_user.username:
        existing = User.query.filter_by(username=new_username).first()
        if existing:
            flash('Ім\'я зайняте')
            return redirect(url_for('main.profile'))
        current_user.username = new_username
    
    db.session.commit()
    flash('Профіль оновлено!')
    return redirect(url_for('main.index'))

@main.route('/upload_avatar', methods=['POST'])
@login_required
def upload_avatar():
    if 'avatar' not in request.files: return jsonify({'success': False}), 400
    file = request.files['avatar']
    if not file.filename: return jsonify({'success': False}), 400
    
    try:
        res = cloudinary.uploader.upload(file, folder='avatars', transformation=[{'width':200,'height':200,'crop':'fill'}])
        current_user.avatar_url = res.get('secure_url')
        db.session.commit()
        return jsonify({'success': True, 'avatar_url': current_user.avatar_url})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@main.route('/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files['file']
    recipient_id = request.form.get('recipient_id')
    if not file.filename or not recipient_id: return jsonify({"error": "Missing data"}), 400

    file_type = 'image'
    if file.mimetype.startswith('video/'): file_type = 'video'
    elif file.mimetype == 'image/gif': file_type = 'gif'

    try:
        res = cloudinary.uploader.upload(file, resource_type='video' if file_type=='video' else 'image')
        msg = Message(
            sender_id=current_user.id,
            recipient_id=int(recipient_id),
            media_url=res.get('secure_url'),
            media_type=file_type
        )
        db.session.add(msg)
        db.session.commit()

        data = msg.to_dict()
        socketio.emit('new_message', data, room=int(recipient_id))
        socketio.emit('new_message', data, room=current_user.id)
        socketio.emit('force_chat_list_update', room=current_user.id)
        socketio.emit('force_chat_list_update', room=int(recipient_id))
        
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@main.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('main.index'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user is None or not user.check_password(form.password.data):
            flash('Помилка входу')
            return redirect(url_for('main.login'))
        login_user(user, remember=form.remember_me.data)
        user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        return redirect(url_for('main.index'))
    return render_template('login.html', form=form)

@main.route('/logout')
def logout():
    if current_user.is_authenticated:
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
    logout_user()
    return redirect(url_for('main.login'))

@main.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated: return redirect(url_for('main.index'))
    form = RegistrationForm()
    if form.validate_on_submit():
        user = User(username=form.username.data)
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        flash('Успішна реєстрація!')
        return redirect(url_for('main.login'))
    return render_template('register.html', form=form)