# app/events.py
from flask_socketio import emit, join_room, leave_room
from . import socketio, db
from flask_login import current_user
from .models import Message, User
from sqlalchemy import or_, select, func, and_
from datetime import datetime, timezone

online_users = set()

def get_and_emit_chat_list(user_id):
    """
    Знаходить всі активні чати для user_id, сортує їх
    і відправляє список цьому юзеру.
    """
    try:
        # 1. Знаходимо ID останнього повідомлення в кожному чаті
        
        # Підзапит для повідомлень, де юзер - відправник
        sub_sent = select(
            Message.recipient_id.label('partner_id'), 
            func.max(Message.id).label('max_msg_id')
        ).where(Message.sender_id == user_id).group_by(Message.recipient_id)
        
        # Підзапит для повідомлень, де юзер - отримувач
        sub_received = select(
            Message.sender_id.label('partner_id'),
            func.max(Message.id).label('max_msg_id')
        ).where(Message.recipient_id == user_id).group_by(Message.sender_id)
        
        # 2. Об'єднуємо два підзапити
        union_sub = sub_sent.union_all(sub_received).alias('union_sub')
        
        # 3. Знаходимо *фінальне* ID останнього повідомлення (на випадок дублів)
        final_sub = select(
            union_sub.c.partner_id,
            func.max(union_sub.c.max_msg_id).label('last_msg_id')
        ).group_by(union_sub.c.partner_id).alias('final_sub')
        
        # 4. Дістаємо юзерів та текст останнього повідомлення
        stmt = select(
            User, 
            Message.text, 
            Message.timestamp, 
            Message.media_type, 
            Message.sender_id,
            Message.is_read
        ).join_from(
            final_sub, Message, final_sub.c.last_msg_id == Message.id
        ).join_from(
            # Змінено join, щоб він йшов від final_sub, а не Message
            final_sub, User, final_sub.c.partner_id == User.id
        ).order_by(
            Message.timestamp.desc()
        )
        
        chat_partners = db.session.execute(stmt).all()
        
        users_data = []
        for user, last_text, last_ts, media_type, sender_id, is_read in chat_partners:
            user_dict = user.to_dict()
            
            # ===== ВИПРАВЛЕННЯ БАГУ "NoneType" =====
            last_message_str = ""
            if media_type == 'text':
                last_message_str = last_text if last_text is not None else ""
            else:
                media_type_str = media_type.capitalize() if media_type is not None else "Media"
                last_message_str = f'[{media_type_str}]'
            
            # Додаємо префікс "Ви: " для своїх повідомлень
            if sender_id == user_id:
                user_dict['last_message_text'] = "Ви: " + last_message_str
            else:
                user_dict['last_message_text'] = last_message_str
            # ========================================
                
            user_dict['last_message_ts'] = last_ts.isoformat()
            users_data.append(user_dict)
        
        # Відправляємо список чатів тільки цьому юзеру
        emit('users_list', {
            'users': users_data,
            'online_ids': list(online_users)
        }, room=user_id)
        
    except Exception as e:
        print(f"Error in get_and_emit_chat_list (user_id: {user_id}): {e}")
        # Повідомляємо клієнта про помилку
        emit('chat_list_error', {
            'error': str(e)
        }, room=user_id)


@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        join_room(current_user.id)
        online_users.add(current_user.id)
        
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        
        ts = current_user.last_seen.isoformat()
        
        emit('user_status_change', 
             {'user_id': current_user.id, 'status': 'online', 'last_seen': ts}, 
             broadcast=True)
        emit('status', {'text': f'Ви підключені як {current_user.username}'})
        
        # Завантажуємо список активних чатів
        get_and_emit_chat_list(current_user.id)

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        online_users.discard(current_user.id)
        
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        
        ts = current_user.last_seen.isoformat()
        
        emit('user_status_change', 
             {'user_id': current_user.id, 'status': 'offline', 'last_seen': ts}, 
             broadcast=True)

@socketio.on('send_message')
def handle_send_message(data):
    if not current_user.is_authenticated: return
    
    recipient_id = data.get('recipient_id')
    if not recipient_id: return
    
    new_message = Message(
        sender_id=current_user.id,
        recipient_id=int(recipient_id),
        text=data.get('text'),
        media_url=data.get('media_url'),
        media_type=data.get('media_type', 'text'),
        is_read=False
    )
    db.session.add(new_message)
    db.session.commit()
    message_data = new_message.to_dict()

    socketio.emit('new_message', message_data, room=int(recipient_id))
    socketio.emit('new_message', message_data, room=current_user.id)
    
    if int(recipient_id) in online_users:
        socketio.emit('unread_message', message_data, room=int(recipient_id))
    
    # Оновлюємо списки чатів для обох, щоб чат піднявся вгору
    get_and_emit_chat_list(current_user.id)
    get_and_emit_chat_list(int(recipient_id))

@socketio.on('load_history')
def handle_load_history(data):
    if not current_user.is_authenticated: return
    partner_id = data.get('partner_id')
    if not partner_id: return
        
    user_id = current_user.id
    messages = Message.query.filter(
        or_(
            (Message.sender_id == user_id) & (Message.recipient_id == partner_id),
            (Message.sender_id == partner_id) & (Message.recipient_id == user_id)
        )
    ).order_by(Message.timestamp.asc()).all()
    history_data = [msg.to_dict() for msg in messages]
    
    emit('history_loaded', {
        'partner_id': int(partner_id),
        'history': history_data
    })

@socketio.on('mark_as_read')
def handle_mark_as_read(data):
    if not current_user.is_authenticated: return
    
    chat_partner_id = data.get('chat_partner_id')
    if not chat_partner_id: return
    
    my_id = current_user.id 
    
    messages_to_update = Message.query.filter(
        Message.sender_id == chat_partner_id,
        Message.recipient_id == my_id,
        Message.is_read == False
    ).all()
    
    updated_message_ids = []
    for msg in messages_to_update:
        msg.is_read = True
        updated_message_ids.append(msg.id)
        
    if updated_message_ids:
        db.session.commit()
        emit('messages_were_read', 
             {'message_ids': updated_message_ids, 'reader_id': my_id}, 
             room=int(chat_partner_id))

@socketio.on('load_my_gifs')
def handle_load_my_gifs():
    if not current_user.is_authenticated: return
    
    gifs_query = db.session.query(Message.media_url, Message.timestamp).filter(
        Message.sender_id == current_user.id,
        Message.media_type == 'gif'
    ).order_by(Message.timestamp.desc()).limit(100).all()
    
    seen_urls = set()
    gif_urls = []
    for url, ts in gifs_query:
        if url not in seen_urls:
            seen_urls.add(url)
            gif_urls.append(url)
    
    emit('my_gifs_loaded', {'gifs': gif_urls})

@socketio.on('users_list_request')
def handle_users_list_request():
    """Клієнт просить оновити список чатів (наприклад, після пошуку)"""
    if current_user.is_authenticated:
        get_and_emit_chat_list(current_user.id)

@socketio.on('force_chat_list_update')
def handle_force_chat_list_update():
    """Використовується, коли сервер знає, що список чатів іншого юзера змінився"""
    if current_user.is_authenticated:
        get_and_emit_chat_list(current_user.id)