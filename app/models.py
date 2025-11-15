# app/models.py
from app import db
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
from datetime import datetime, timezone

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True)
    password_hash = db.Column(db.String(256))
    
    # Профіль
    display_name = db.Column(db.String(100))  # Відображуване ім'я
    avatar_url = db.Column(db.String(512))    # URL аватара
    bio = db.Column(db.String(500))           # Біографія/статус
    last_seen = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    messages_sent = db.relationship('Message', 
                                    foreign_keys='Message.sender_id', 
                                    backref='sender', lazy='dynamic')
    messages_received = db.relationship('Message', 
                                        foreign_keys='Message.recipient_id', 
                                        backref='recipient', lazy='dynamic')
    
    # Контакти (обране)
    favorites = db.relationship(
        'Favorite',
        foreign_keys='Favorite.user_id',
        backref='owner',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )
    
    def __repr__(self):
        return f'<User {self.username}>'
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def is_favorite(self, user):
        """Перевіряє чи є user в обраному"""
        return self.favorites.filter_by(favorite_id=user.id).first() is not None
    
    def add_favorite(self, user):
        """Додає користувача в обране"""
        if not self.is_favorite(user) and user.id != self.id:
            favorite = Favorite(user_id=self.id, favorite_id=user.id)
            db.session.add(favorite)
            return favorite
        return None
    
    def remove_favorite(self, user):
        """Видаляє користувача з обраного"""
        favorite = self.favorites.filter_by(favorite_id=user.id).first()
        if favorite:
            db.session.delete(favorite)
    
    def get_favorites(self):
        """Повертає список обраних користувачів"""
        return User.query.join(
            Favorite, (Favorite.favorite_id == User.id)
        ).filter(Favorite.user_id == self.id).all()
    
    def get_display_name(self):
        """Повертає відображуване ім'я або username"""
        return self.display_name if self.display_name else self.username
    
    def to_dict(self, include_bio=False):
        ts = None 
        if self.last_seen:
            ts = self.last_seen.isoformat()
            if not ts.endswith('Z') and '+' not in ts:
                ts += 'Z'
        
        data = {
            'id': self.id,
            'username': self.username,
            'display_name': self.get_display_name(),
            'avatar_url': self.avatar_url,
            'last_seen': ts
        }
        
        if include_bio:
            data['bio'] = self.bio
        
        return data


class Favorite(db.Model):
    """Таблиця обраних контактів"""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    favorite_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    __table_args__ = (
        db.UniqueConstraint('user_id', 'favorite_id', name='unique_favorite'),
    )
    
    def __repr__(self):
        return f'<Favorite {self.user_id} -> {self.favorite_id}>'


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(1024), nullable=True) 
    media_url = db.Column(db.String(512), nullable=True)
    media_type = db.Column(db.String(50), default='text', nullable=False)
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    timestamp = db.Column(db.DateTime, index=True, default=datetime.utcnow) 
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    recipient_id = db.Column(db.Integer, db.ForeignKey('user.id'))

    def __repr__(self):
        return f'<Message {self.media_type}: {self.text[:50] if self.text else ""}>'
    
    def to_dict(self):
        ts = self.timestamp.isoformat()
        if not ts.endswith('Z') and '+' not in ts:
            ts += 'Z'
        return {
            'id': self.id,
            'text': self.text, 
            'media_url': self.media_url,
            'media_type': self.media_type,
            'timestamp': ts, 
            'sender_id': self.sender_id,
            'sender_username': self.sender.username,
            'sender_display_name': self.sender.get_display_name(),
            'sender_avatar': self.sender.avatar_url,
            'recipient_id': self.recipient_id,
            'is_read': self.is_read
        }