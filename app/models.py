# app/models.py
from app import db
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
from datetime import datetime, timezone # <-- Перевір цей імпорт

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True)
    password_hash = db.Column(db.String(256))
    
    messages_sent = db.relationship('Message', 
                                    foreign_keys='Message.sender_id', 
                                    backref='sender', lazy='dynamic')
                                    
    messages_received = db.relationship('Message', 
                                        foreign_keys='Message.recipient_id', 
                                        backref='recipient', lazy='dynamic')

    def __repr__(self):
        return f'<User {self.username}>'
    # ... (методи set_password/check_password) ...
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(1024), nullable=True) 
    image_url = db.Column(db.String(512), nullable=True)
    is_image = db.Column(db.Boolean, default=False)
    
    # === ОСЬ ФІКС ЧАСУ ===
    timestamp = db.Column(db.DateTime, index=True, default=lambda: datetime.now(timezone.utc))
    
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    recipient_id = db.Column(db.Integer, db.ForeignKey('user.id'))

    def __repr__(self):
        return f'<Message {self.text[:50] if self.text else "Image"}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'text': self.text,
            'image_url': self.image_url,
            'is_image': self.is_image,
            'timestamp': self.timestamp.isoformat(), 
            'sender_id': self.sender_id,
            'sender_username': self.sender.username,
            'recipient_id': self.recipient_id,
            'recipient_username': self.recipient.username
        }