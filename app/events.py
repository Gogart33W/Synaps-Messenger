# app/events.py
from flask_socketio import emit, join_room, leave_room
from . import socketio, db
from flask_login import current_user
from .models import Message, User
from sqlalchemy import or_
from datetime import datetime, timezone

online_users = set()

@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        join_room(current_user.id)
        online_users.add(current_user.id)
        
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        
        ts = current_user.last_seen.isoformat()
        if not ts.endswith('Z') and '+' not in ts: ts += 'Z'
        
        emit('user_status_change', 
             {'user_id': current_user.id, 'status': 'online', 'last_seen': ts}, 
             broadcast=True)
        emit('status', {'text': f'Ви підключені як {current_user.username}'} )
        
        users_query = User.query.filter(User.id != current_user.id).all()
        users_data = [user.to_dict() for user in users_query]
        emit('users_list', {
            'users': users_data,
            'online_ids': list(online_users)
        })

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        online_users.discard(current_user.id)
        
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        
        ts = current_user.last_seen.isoformat()
        if not ts.endswith('Z') and '+' not in ts: ts += 'Z'
        
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

# === ФІКС SQL-ЗАПИТУ ДЛЯ ГІФОК ===
@socketio.on('load_my_gifs')
def handle_load_my_gifs():
    if not current_user.is_authenticated: return
    
    # Замість DISTINCT, ми беремо всі, сортуємо, 
    # а потім унікалізуємо в Python
    gifs_query = db.session.query(Message.media_url, Message.timestamp).filter(
        Message.sender_id == current_user.id,
        Message.media_type == 'gif'
    ).order_by(Message.timestamp.desc()).limit(100).all()
    
    # Унікалізуємо, зберігаючи порядок
    seen_urls = set()
    gif_urls = []
    for url, ts in gifs_query:
        if url not in seen_urls:
            seen_urls.add(url)
            gif_urls.append(url)
    
    emit('my_gifs_loaded', {'gifs': gif_urls})