# app/events.py
from flask_socketio import emit, join_room, leave_room
from . import socketio, db
from flask_login import current_user
from .models import Message, User
from sqlalchemy import or_

online_users = set()

@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        join_room(current_user.id)
        online_users.add(current_user.id)
        emit('user_status_change', 
             {'user_id': current_user.id, 'status': 'online'}, 
             broadcast=True)
        emit('status', {'text': f'Ви підключені як {current_user.username}'} )

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        online_users.discard(current_user.id)
        emit('user_status_change', 
             {'user_id': current_user.id, 'status': 'offline'}, 
             broadcast=True)

@socketio.on('send_message')
def handle_send_message(data):
    if not current_user.is_authenticated: return
    text = data.get('text', '')
    recipient_id = data.get('recipient_id')
    if not text or not recipient_id: return
        
    new_message = Message(
        text=text,
        sender_id=current_user.id,
        recipient_id=int(recipient_id),
        is_read=False
    )
    db.session.add(new_message)
    db.session.commit()
    message_data = new_message.to_dict()

    socketio.emit('new_message', message_data, room=int(recipient_id))
    socketio.emit('new_message', message_data, room=current_user.id)
    
    if int(recipient_id) in online_users:
        socketio.emit('unread_message', 
                      message_data, 
                      room=int(recipient_id))

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
    emit('online_users_list', list(online_users))

@socketio.on('mark_as_read')
def handle_mark_as_read(data):
    if not current_user.is_authenticated: return
    
    sender_id = data.get('sender_id') 
    if not sender_id: return

    recipient_id = current_user.id 
    
    messages_to_update = Message.query.filter(
        Message.sender_id == sender_id,
        Message.recipient_id == recipient_id,
        Message.is_read == False
    ).all()
    
    updated_message_ids = []
    for msg in messages_to_update:
        msg.is_read = True
        updated_message_ids.append(msg.id)
        
    if updated_message_ids:
        db.session.commit()
        emit('messages_were_read', 
             {'message_ids': updated_message_ids, 'sender_id': sender_id}, 
             room=int(sender_id))