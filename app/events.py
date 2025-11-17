# app/events.py
from flask_socketio import emit, join_room, leave_room
from . import socketio, db
from flask_login import current_user
from .models import Message, User, MessageReaction
from sqlalchemy import or_, select, func, and_
from datetime import datetime, timezone

online_users = set()
typing_users = {}

def get_and_emit_chat_list(user_id):
    """Генерує та відправляє список чатів конкретному користувачу"""
    try:
        # 1. Знаходимо всіх, з ким були повідомлення (відправлені або отримані)
        # Виключаємо видалені повідомлення з логіки "останнього повідомлення"
        
        # ID повідомлень, де user_id був відправником
        sub_sent = select(
            Message.recipient_id.label('partner_id'), 
            func.max(Message.id).label('max_msg_id')
        ).where(
            Message.sender_id == user_id,
            Message.is_deleted == False
        ).group_by(Message.recipient_id)
        
        # ID повідомлень, де user_id був отримувачем
        sub_received = select(
            Message.sender_id.label('partner_id'),
            func.max(Message.id).label('max_msg_id')
        ).where(
            Message.recipient_id == user_id,
            Message.is_deleted == False
        ).group_by(Message.sender_id)
        
        # Об'єднуємо результати
        union_sub = sub_sent.union_all(sub_received).alias('union_sub')
        
        # Знаходимо фінальний ID останнього повідомлення для кожного партнера
        final_sub = select(
            union_sub.c.partner_id,
            func.max(union_sub.c.max_msg_id).label('last_msg_id')
        ).group_by(union_sub.c.partner_id).alias('final_sub')
        
        # Витягуємо деталі повідомлення та користувача
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
            final_sub, User, final_sub.c.partner_id == User.id
        ).order_by(
            Message.timestamp.desc()
        )
        
        chat_partners = db.session.execute(stmt).all()
        
        users_data = []
        for user, last_text, last_ts, media_type, sender_id, is_read in chat_partners:
            user_dict = user.to_dict()
            
            # Формуємо текст останнього повідомлення
            last_message_str = ""
            if media_type == 'text':
                last_message_str = last_text if last_text else ""
            else:
                media_type_str = media_type.capitalize() if media_type else "Media"
                last_message_str = f'[{media_type_str}]'
            
            if sender_id == user_id:
                user_dict['last_message_text'] = "Ви: " + last_message_str
            else:
                user_dict['last_message_text'] = last_message_str
                
            user_dict['last_message_ts'] = last_ts.isoformat()
            users_data.append(user_dict)
        
        # Відправляємо подію ТІЛЬКИ цьому користувачу
        emit('users_list', {
            'users': users_data,
            'online_ids': list(online_users)
        }, room=user_id)
        
    except Exception as e:
        print(f"Error in get_and_emit_chat_list for {user_id}: {e}")
        # Не відправляємо помилку клієнту, щоб не лякати інтерфейс, просто логуємо

@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        join_room(current_user.id)
        online_users.add(current_user.id)
        
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        
        ts = current_user.last_seen.isoformat()
        
        # Сповіщаємо всіх, що юзер онлайн
        emit('user_status_change', 
             {'user_id': current_user.id, 'status': 'online', 'last_seen': ts}, 
             broadcast=True)
        
        # Відправляємо юзеру його список чатів
        get_and_emit_chat_list(current_user.id)

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        online_users.discard(current_user.id)
        
        # Очищаємо статуси друку
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
    
    try:
        recipient_id = int(recipient_id)
        
        new_message = Message(
            sender_id=current_user.id,
            recipient_id=recipient_id,
            text=data.get('text'),
            media_url=data.get('media_url'),
            media_type=data.get('media_type', 'text'),
            is_read=False,
            reply_to_id=data.get('reply_to_id'),
            forwarded_from_id=data.get('forwarded_from_id')
        )
        db.session.add(new_message)
        db.session.commit()
        
        message_data = new_message.to_dict()

        # 1. Відправляємо саме повідомлення обом
        socketio.emit('new_message', message_data, room=recipient_id)
        socketio.emit('new_message', message_data, room=current_user.id)
        
        # 2. Сповіщення про непрочитане (звук/пуш)
        if recipient_id in online_users:
            socketio.emit('unread_message', message_data, room=recipient_id)
        
        # 3. ПРИМУСОВЕ оновлення списку чатів для ОБОХ
        # Це вирішує проблему, коли новий чат не з'являється
        get_and_emit_chat_list(current_user.id)
        get_and_emit_chat_list(recipient_id)
        
    except Exception as e:
        db.session.rollback()
        print(f"Error sending message: {e}")
        emit('error', {'text': 'Помилка відправки повідомлення'})

@socketio.on('delete_message')
def handle_delete_message(data):
    if not current_user.is_authenticated: return
    
    message_id = data.get('message_id')
    if not message_id: return
    
    message = Message.query.get(message_id)
    if not message: return
    
    if message.sender_id != current_user.id:
        return
    
    message.is_deleted = True
    db.session.commit()
    
    message_data = message.to_dict()
    
    # Сповіщаємо про видалення
    socketio.emit('message_deleted', message_data, room=message.sender_id)
    socketio.emit('message_deleted', message_data, room=message.recipient_id)
    
    # Оновлюємо списки чатів (бо текст останнього повідомлення змінився на "видалено")
    get_and_emit_chat_list(message.sender_id)
    get_and_emit_chat_list(message.recipient_id)

@socketio.on('add_reaction')
def handle_add_reaction(data):
    if not current_user.is_authenticated: return
    
    message_id = data.get('message_id')
    emoji = data.get('emoji')
    
    if not message_id or not emoji: return
    
    message = Message.query.get(message_id)
    if not message or message.is_deleted: return
    
    # Перевірка доступу
    if current_user.id not in [message.sender_id, message.recipient_id]:
        return
    
    existing = MessageReaction.query.filter_by(
        message_id=message_id,
        user_id=current_user.id,
        emoji=emoji
    ).first()
    
    if existing:
        db.session.delete(existing)
    else:
        reaction = MessageReaction(message_id=message_id, user_id=current_user.id, emoji=emoji)
        db.session.add(reaction)
    
    db.session.commit()
    
    # Відправляємо оновлені реакції
    # Важливо отримати свіжі дані з БД
    updated_msg = Message.query.get(message_id)
    reactions_data = updated_msg.to_dict()['reactions']
    
    socketio.emit('reaction_updated', {
        'message_id': message_id,
        'reactions': reactions_data
    }, room=message.sender_id)
    
    socketio.emit('reaction_updated', {
        'message_id': message_id,
        'reactions': reactions_data
    }, room=message.recipient_id)

@socketio.on('typing_start')
def handle_typing_start(data):
    if not current_user.is_authenticated: return
    partner_id = data.get('partner_id')
    if partner_id:
        emit('typing_status', {'user_id': current_user.id, 'is_typing': True}, room=int(partner_id))

@socketio.on('typing_stop')
def handle_typing_stop(data):
    if not current_user.is_authenticated: return
    partner_id = data.get('partner_id')
    if partner_id:
        emit('typing_status', {'user_id': current_user.id, 'is_typing': False}, room=int(partner_id))

@socketio.on('load_history')
def handle_load_history(data):
    if not current_user.is_authenticated: return
    partner_id = data.get('partner_id')
    if not partner_id: return
        
    messages = Message.query.filter(
        or_(
            (Message.sender_id == current_user.id) & (Message.recipient_id == partner_id),
            (Message.sender_id == partner_id) & (Message.recipient_id == current_user.id)
        )
    ).order_by(Message.timestamp.asc()).all()
    
    history_data = [msg.to_dict() for msg in messages]
    emit('history_loaded', {'partner_id': int(partner_id), 'history': history_data})

@socketio.on('mark_as_read')
def handle_mark_as_read(data):
    if not current_user.is_authenticated: return
    chat_partner_id = data.get('chat_partner_id')
    if not chat_partner_id: return
    
    db.session.query(Message).filter(
        Message.sender_id == chat_partner_id,
        Message.recipient_id == current_user.id,
        Message.is_read == False
    ).update({Message.is_read: True})
    
    db.session.commit()
    
    # Отримуємо ID прочитаних повідомлень (спрощено - просто кажемо що все прочитано)
    # Для точного оновлення UI краще б відправляти ID, але для швидкості поки так
    emit('messages_were_read', {'reader_id': current_user.id}, room=int(chat_partner_id))

@socketio.on('users_list_request')
def handle_users_list_request():
    if current_user.is_authenticated:
        get_and_emit_chat_list(current_user.id)