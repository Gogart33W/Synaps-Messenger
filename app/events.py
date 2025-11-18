# app/events.py (ТІЛЬКИ ФУНКЦІЯ handle_add_reaction ЗМІНЕНА, АЛЕ ОСЬ ПОВНИЙ ФАЙЛ ДЛЯ ЗРУЧНОСТІ)
from flask_socketio import emit, join_room, leave_room
from . import socketio, db
from flask_login import current_user
from .models import Message, User, MessageReaction
from sqlalchemy import or_, select, func, and_
from datetime import datetime, timezone

online_users = set()
typing_users = {}

def get_and_emit_chat_list(user_id):
    try:
        sub_sent = select(Message.recipient_id.label('partner_id'), func.max(Message.id).label('max_msg_id')).where(Message.sender_id == user_id, Message.is_deleted == False).group_by(Message.recipient_id)
        sub_received = select(Message.sender_id.label('partner_id'), func.max(Message.id).label('max_msg_id')).where(Message.recipient_id == user_id, Message.is_deleted == False).group_by(Message.sender_id)
        union_sub = sub_sent.union_all(sub_received).alias('union_sub')
        final_sub = select(union_sub.c.partner_id, func.max(union_sub.c.max_msg_id).label('last_msg_id')).group_by(union_sub.c.partner_id).alias('final_sub')
        stmt = select(User, Message.text, Message.timestamp, Message.media_type, Message.sender_id, Message.is_read).join_from(final_sub, Message, final_sub.c.last_msg_id == Message.id).join_from(final_sub, User, final_sub.c.partner_id == User.id).order_by(Message.timestamp.desc())
        
        chat_partners = db.session.execute(stmt).all()
        users_data = []
        for user, last_text, last_ts, media_type, sender_id, is_read in chat_partners:
            user_dict = user.to_dict()
            txt = last_text if media_type == 'text' else f'[{media_type.capitalize()}]'
            user_dict['last_message_text'] = ("Ви: " + txt) if sender_id == user_id else txt
            user_dict['last_message_ts'] = last_ts.isoformat()
            users_data.append(user_dict)
        
        emit('users_list', {'users': users_data, 'online_ids': list(online_users)}, room=user_id)
    except Exception as e: print(f"Error chat list: {e}")

@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        join_room(current_user.id)
        online_users.add(current_user.id)
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        emit('user_status_change', {'user_id': current_user.id, 'status': 'online', 'last_seen': current_user.last_seen.isoformat()}, broadcast=True)
        get_and_emit_chat_list(current_user.id)

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        online_users.discard(current_user.id)
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        emit('user_status_change', {'user_id': current_user.id, 'status': 'offline', 'last_seen': current_user.last_seen.isoformat()}, broadcast=True)

@socketio.on('send_message')
def handle_send_message(data):
    if not current_user.is_authenticated: return
    recipient_id = data.get('recipient_id')
    if not recipient_id: return
    
    try:
        new_message = Message(sender_id=current_user.id, recipient_id=int(recipient_id), text=data.get('text'), media_url=data.get('media_url'), media_type=data.get('media_type', 'text'), is_read=False, reply_to_id=data.get('reply_to_id'), forwarded_from_id=data.get('forwarded_from_id'))
        db.session.add(new_message)
        db.session.commit()
        
        msg_data = new_message.to_dict()
        socketio.emit('new_message', msg_data, room=int(recipient_id))
        socketio.emit('new_message', msg_data, room=current_user.id)
        if int(recipient_id) in online_users: socketio.emit('unread_message', msg_data, room=int(recipient_id))
        
        get_and_emit_chat_list(current_user.id)
        get_and_emit_chat_list(int(recipient_id))
    except: db.session.rollback()

@socketio.on('delete_message')
def handle_delete_message(data):
    if not current_user.is_authenticated: return
    msg = Message.query.get(data.get('message_id'))
    if msg and msg.sender_id == current_user.id:
        msg.is_deleted = True
        db.session.commit()
        data = msg.to_dict()
        socketio.emit('message_deleted', data, room=msg.sender_id)
        socketio.emit('message_deleted', data, room=msg.recipient_id)
        get_and_emit_chat_list(msg.sender_id)
        get_and_emit_chat_list(msg.recipient_id)

@socketio.on('add_reaction')
def handle_add_reaction(data):
    if not current_user.is_authenticated: return
    message_id = data.get('message_id')
    emoji = data.get('emoji')
    
    message = Message.query.get(message_id)
    if not message: return

    # === ВИПРАВЛЕННЯ: ОДНА РЕАКЦІЯ НА ЮЗЕРА ===
    # 1. Шукаємо, чи ставив цей юзер ВЖЕ якусь реакцію на це повідомлення
    existing = MessageReaction.query.filter_by(
        message_id=message_id,
        user_id=current_user.id
    ).first()
    
    if existing:
        # Якщо ставив...
        if existing.emoji == emoji:
            # ...і це та сама емодзі -> видаляємо (Toggle OFF)
            db.session.delete(existing)
        else:
            # ...і це ІНША емодзі -> змінюємо на нову (Switch)
            existing.emoji = emoji
            # db.session.add(existing) - не треба, об'єкт вже в сесії
    else:
        # Якщо не ставив -> додаємо нову
        reaction = MessageReaction(message_id=message_id, user_id=current_user.id, emoji=emoji)
        db.session.add(reaction)
    
    db.session.commit()
    
    # Оновлюємо
    updated_msg = Message.query.get(message_id)
    reactions = updated_msg.to_dict()['reactions']
    socketio.emit('reaction_updated', {'message_id': message_id, 'reactions': reactions}, room=message.sender_id)
    socketio.emit('reaction_updated', {'message_id': message_id, 'reactions': reactions}, room=message.recipient_id)

@socketio.on('typing_start')
def handle_typing_start(data):
    if current_user.is_authenticated and data.get('partner_id'):
        emit('typing_status', {'user_id': current_user.id, 'is_typing': True}, room=int(data['partner_id']))

@socketio.on('typing_stop')
def handle_typing_stop(data):
    if current_user.is_authenticated and data.get('partner_id'):
        emit('typing_status', {'user_id': current_user.id, 'is_typing': False}, room=int(data['partner_id']))

@socketio.on('load_history')
def handle_load_history(data):
    if not current_user.is_authenticated: return
    partner_id = data.get('partner_id')
    msgs = Message.query.filter(or_((Message.sender_id == current_user.id) & (Message.recipient_id == partner_id), (Message.sender_id == partner_id) & (Message.recipient_id == current_user.id))).order_by(Message.timestamp.asc()).all()
    emit('history_loaded', {'partner_id': int(partner_id), 'history': [m.to_dict() for m in msgs]})

@socketio.on('mark_as_read')
def handle_mark_as_read(data):
    if not current_user.is_authenticated: return
    chat_partner_id = data.get('chat_partner_id')
    if chat_partner_id:
        db.session.query(Message).filter(Message.sender_id == chat_partner_id, Message.recipient_id == current_user.id, Message.is_read == False).update({Message.is_read: True})
        db.session.commit()
        emit('messages_were_read', {'reader_id': current_user.id}, room=int(chat_partner_id))

@socketio.on('users_list_request')
def handle_users_list_request():
    if current_user.is_authenticated: get_and_emit_chat_list(current_user.id)