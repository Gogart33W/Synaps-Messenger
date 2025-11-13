# app/events.py
from flask_socketio import emit, join_room, leave_room
from . import socketio, db # <-- ІМПОРТУЄМО 'db'
from flask_login import current_user
from .models import Message, User # <-- ІМПОРТУЄМО МОДЕЛІ
from sqlalchemy import or_ # Для складного запиту

@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        join_room(current_user.id)
        print(f'Клієнт {current_user.username} (ID: {current_user.id}) підключився.')
        emit('status', {'text': f'Ви підключені як {current_user.username}'} )

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        print(f'Клієнт {current_user.username} відключився.')


# === ОНОВЛЕНИЙ ОБРОБНИК ВІДПРАВКИ ===
@socketio.on('send_message')
def handle_send_message(data):
    """
    Отримує, ЗБЕРІГАЄ В БД, та пересилає повідомлення.
    """
    if not current_user.is_authenticated:
        return

    text = data.get('text', '')
    recipient_id = data.get('recipient_id')
    
    if not text or not recipient_id:
        return
        
    # 1. Створюємо об'єкт для БД
    new_message = Message(
        text=text,
        sender_id=current_user.id,
        recipient_id=int(recipient_id)
    )
    
    # 2. Зберігаємо в БД
    db.session.add(new_message)
    db.session.commit()
    
    print(f"Збережено в БД: {new_message}")

    # 3. Перетворюємо на словник (з часом, іменами і т.д.)
    message_data = new_message.to_dict()

    # 4. Пересилаємо (emit)
    socketio.emit('new_message', message_data, room=int(recipient_id))
    socketio.emit('new_message', message_data, room=current_user.id)


# === НОВИЙ ОБРОБНИК ДЛЯ ЗАВАНТАЖЕННЯ ІСТОРІЇ ===
@socketio.on('load_history')
def handle_load_history(data):
    """
    Завантажує історію чату між двома користувачами.
    """
    if not current_user.is_authenticated:
        return
        
    partner_id = data.get('partner_id')
    if not partner_id:
        return
        
    user_id = current_user.id
    
    # Складний запит:
    # Вибрати всі повідомлення, ДЕ
    # (я = відправник І він = отримувач)
    # АБО
    # (він = відправник І я = отримувач)
    messages = Message.query.filter(
        or_(
            (Message.sender_id == user_id) & (Message.recipient_id == partner_id),
            (Message.sender_id == partner_id) & (Message.recipient_id == user_id)
        )
    ).order_by(Message.timestamp.asc()).all() # Сортуємо за часом

    # Перетворюємо на список словників
    history_data = [msg.to_dict() for msg in messages]
    
    print(f"Завантажено {len(history_data)} повідомлень для чату {user_id}-{partner_id}")
    
    # Відправляємо історію ТІЛЬКИ тому, хто попросив
    emit('history_loaded', {
        'partner_id': int(partner_id),
        'history': history_data
    })