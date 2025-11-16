# app/events.py
from flask_socketio import emit, join_room, leave_room
from . import socketio, db
from flask_login import current_user
from .models import Message, User, MessageReaction
from sqlalchemy import or_, select, func, and_
from datetime import datetime, timezone

online_users = set()
typing_users = {}  # {user_id: {partner_id: timestamp}}

def get_and_emit_chat_list(user_id):
    """Знаходить всі активні чати для user_id і відправляє список"""
    try:
        # Підзапит для повідомлень, де юзер - відправник (виключаємо видалені)
        sub_sent = select(
            Message.recipient_id.label('partner_id'), 
            func.max(Message.id).label('max_msg_id')
        ).where(
            Message.sender_id == user_id
        ).group_by(Message.recipient_id)
        
        # Підзапит для повідомлень, де юзер - отримувач (виключаємо видалені)
        sub_received = select(
            Message.sender_id.label('partner_id'),
            func.max(Message.id).label('max_msg_id')
        ).where(
            Message.recipient_id == user_id
        ).group_by(Message.sender_id)
        
        union_sub = sub_sent.union_all(sub_received).alias('union_sub')
        
        final_sub = select(
            union_sub.c.partner_id,
            func.max(union_sub.c.max_msg_id).label('last_msg_id')
        ).group_by(union_sub.c.partner_id).alias('final_sub')
        
        stmt = select(
            User, 
            Message.text, 
            Message.timestamp, 
            Message.media_type, 
            Message.sender_id,
            Message.is_read,
            Message.is_deleted
        ).join_from(
            final_sub, Message, final_sub.c.last_msg_id == Message.id
        ).join_from(
            final_sub, User, final_sub.c.partner_id == User.id
        ).order_by(
            Message.timestamp.desc()
        )
        
        chat_partners = db.session.execute(stmt).all()
        
        users_data = []
        for user, last_text, last_ts, media_type, sender_id, is_read, is_deleted in chat_partners:
            user_dict = user.to_dict()
            
            last_message_str = ""
            if is_deleted:
                last_message_str = "[Повідомлення видалено]"
            elif media_type == 'text':
                last_message_str = last_text if last_text is not None else ""
            else:
                media_type_str = media_type.capitalize() if media_type is not None else "Media"
                last_message_str = f'[{media_type_str}]'
            
            if sender_id == user_id:
                user_dict['last_message_text'] = "Ви: " + last_message_str
            else:
                user_dict['last_message_text'] = last_message_str
                
            user_dict['last_message_ts'] = last_ts.isoformat()
            users_data.append(user_dict)
        
        emit('users_list', {
            'users': users_data,
            'online_ids': list(online_users)
        }, room=user_id)
        
    except Exception as e:
        print(f"Error in get_and_emit_chat_list (user_id: {user_id}): {e}")
        emit('chat_list_error', {'error': str(e)}, room=user_id)


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
        
        get_and_emit_chat_list(current_user.id)

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        online_users.discard(current_user.id)
        
        # Очищаємо typing status
        if current_user.id in typing_users:
            for partner_id in list(typing_users[current_user.id].keys()):
                emit('typing_status', {
                    'user_id': current_user.id,
                    'is_typing': False
                }, room=partner_id)
            del typing_users[current_user.id]
        
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
    
    reply_to_id = data.get('reply_to_id')
    forwarded_from_id = data.get('forwarded_from_id')
    
    new_message = Message(
        sender_id=current_user.id,
        recipient_id=int(recipient_id),
        text=data.get('text'),
        media_url=data.get('media_url'),
        media_type=data.get('media_type', 'text'),
        is_read=False,
        reply_to_id=reply_to_id,
        forwarded_from_id=forwarded_from_id
    )
    db.session.add(new_message)
    db.session.commit()
    message_data = new_message.to_dict()

    socketio.emit('new_message', message_data, room=int(recipient_id))
    socketio.emit('new_message', message_data, room=current_user.id)
    
    if int(recipient_id) in online_users:
        socketio.emit('unread_message', message_data, room=int(recipient_id))
    
    get_and_emit_chat_list(current_user.id)
    get_and_emit_chat_list(int(recipient_id))

@socketio.on('delete_message')
def handle_delete_message(data):
    """Видалення повідомлення"""
    if not current_user.is_authenticated: return
    
    message_id = data.get('message_id')
    if not message_id: return
    
    message = Message.query.get(message_id)
    if not message:
        emit('error', {'text': 'Повідомлення не знайдено'})
        return
    
    # Перевіряємо що це наше повідомлення
    if message.sender_id != current_user.id:
        emit('error', {'text': 'Ви можете видаляти тільки свої повідомлення'})
        return
    
    # ВИПРАВЛЕНО: Позначаємо як видалене, але НЕ обнуляємо текст/медіа
    # Це потрібно для історії та reply
    message.is_deleted = True
    db.session.commit()
    
    # Повідомляємо обох користувачів
    message_data = message.to_dict()
    socketio.emit('message_deleted', message_data, room=message.sender_id)
    socketio.emit('message_deleted', message_data, room=message.recipient_id)
    
    # Оновлюємо списки чатів
    get_and_emit_chat_list(message.sender_id)
    get_and_emit_chat_list(message.recipient_id)

@socketio.on('add_reaction')
def handle_add_reaction(data):
    """Додати реакцію на повідомлення"""
    if not current_user.is_authenticated: return
    
    message_id = data.get('message_id')
    emoji = data.get('emoji')
    
    if not message_id or not emoji: return
    
    message = Message.query.get(message_id)
    if not message:
        emit('error', {'text': 'Повідомлення не знайдено'})
        return
    
    # Перевіряємо чи можемо реагувати (учасники чату)
    if message.sender_id != current_user.id and message.recipient_id != current_user.id:
        emit('error', {'text': 'Ви не можете реагувати на це повідомлення'})
        return
    
    # Не дозволяємо реагувати на видалені повідомлення
    if message.is_deleted:
        emit('error', {'text': 'Не можна реагувати на видалене повідомлення'})
        return
    
    # Перевіряємо чи вже є така реакція
    existing = MessageReaction.query.filter_by(
        message_id=message_id,
        user_id=current_user.id,
        emoji=emoji
    ).first()
    
    if existing:
        # Видаляємо реакцію якщо вже є (toggle)
        db.session.delete(existing)
        db.session.commit()
    else:
        # Додаємо нову реакцію
        reaction = MessageReaction(
            message_id=message_id,
            user_id=current_user.id,
            emoji=emoji
        )
        db.session.add(reaction)
        db.session.commit()
    
    # Відправляємо оновлені реакції
    message_data = message.to_dict()
    socketio.emit('reaction_updated', {
        'message_id': message_id,
        'reactions': message_data['reactions']
    }, room=message.sender_id)
    socketio.emit('reaction_updated', {
        'message_id': message_id,
        'reactions': message_data['reactions']
    }, room=message.recipient_id)

@socketio.on('typing_start')
def handle_typing_start(data):
    """Користувач почав друкувати"""
    if not current_user.is_authenticated: return
    
    partner_id = data.get('partner_id')
    if not partner_id: return
    
    if current_user.id not in typing_users:
        typing_users[current_user.id] = {}
    
    typing_users[current_user.id][int(partner_id)] = datetime.now(timezone.utc)
    
    emit('typing_status', {
        'user_id': current_user.id,
        'is_typing': True
    }, room=int(partner_id))

@socketio.on('typing_stop')
def handle_typing_stop(data):
    """Користувач перестав друкувати"""
    if not current_user.is_authenticated: return
    
    partner_id = data.get('partner_id')
    if not partner_id: return
    
    if current_user.id in typing_users and int(partner_id) in typing_users[current_user.id]:
        del typing_users[current_user.id][int(partner_id)]
    
    emit('typing_status', {
        'user_id': current_user.id,
        'is_typing': False
    }, room=int(partner_id))

@socketio.on('load_history')
def handle_load_history(data):
    if not current_user.is_authenticated: return
    partner_id = data.get('partner_id')
    if not partner_id: return
        
    user_id = current_user.id
    # ВИПРАВЛЕНО: Завантажуємо ВСІ повідомлення, включаючи видалені
    # Клієнт сам вирішить як їх показувати
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
        Message.media_type == 'gif',
        Message.is_deleted == False  # ВИПРАВЛЕНО: Не показуємо видалені GIF
    ).order_by(Message.timestamp.desc()).limit(100).all()
    
    seen_urls = set()
    gif_urls = []
    for url, ts in gifs_query:
        if url and url not in seen_urls:  # ВИПРАВЛЕНО: Перевіряємо що URL не None
            seen_urls.add(url)
            gif_urls.append(url)
    
    emit('my_gifs_loaded', {'gifs': gif_urls})

@socketio.on('users_list_request')
def handle_users_list_request():
    if current_user.is_authenticated:
        get_and_emit_chat_list(current_user.id)

@socketio.on('force_chat_list_update')
def handle_force_chat_list_update():
    if current_user.is_authenticated:
        get_and_emit_chat_list(current_user.id)