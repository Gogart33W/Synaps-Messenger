# app/models.py
from app import db
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
from datetime import datetime, timezone

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True)
    password_hash = db.Column(db.String(256))
    last_seen = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    messages_sent = db.relationship('Message', 
                                    foreign_keys='Message.sender_id', 
                                    backref='sender', lazy='dynamic')
    messages_received = db.relationship('Message', 
                                        foreign_keys='Message.recipient_id', 
                                        backref='recipient', lazy='dynamic')
    def __repr__(self):
        return f'<User {self.username}>'
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        ts = None 
        if self.last_seen:
            ts = self.last_seen.isoformat()
            if not ts.endswith('Z') and '+' not in ts:
                ts += 'Z'
        return {
            'id': self.id,
            'username': self.username,
            'last_seen': ts
        }

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    
    # === ЗМІНИ ДЛЯ МІГРАЦІЇ ===
    # 'text' тепер зберігає і 'gif-url'
    text = db.Column(db.String(1024), nullable=True) 
    # 'image_url' -> 'media_url' (для фото ТА відео)
    media_url = db.Column(db.String(512), nullable=True)
    # 'is_image' -> 'media_type' (text, image, video, gif)
    media_type = db.Column(db.String(50), default='text', nullable=False)

    is_read = db.Column(db.Boolean, default=False, nullable=False)
    timestamp = db.Column(db.DateTime, index=True, default=datetime.utcnow) 
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    recipient_id = db.Column(db.Integer, db.ForeignKey('user.id'))

    def __repr__(self):
        return f'<Message {self.media_type}: {self.text[:50]}>'
    
    def to_dict(self):
        ts = self.timestamp.isoformat()
        if not ts.endswith('Z') and '+' not in ts:
            ts += 'Z'
        return {
            'id': self.id,
            'text': self.text, 
            'media_url': self.media_url,   # <-- Оновлено
            'media_type': self.media_type, # <-- Оновлено
            'timestamp': ts, 
            'sender_id': self.sender_id,
            'sender_username': self.sender.username,
            'recipient_id': self.recipient_id,
            'is_read': self.is_read
        }