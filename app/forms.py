# app/forms.py
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, BooleanField, SubmitField
from wtforms.validators import DataRequired, ValidationError, EqualTo
from .models import User
import re # <-- НОВИЙ ІМПОРТ

class LoginForm(FlaskForm):
    """Форма для входу."""
    username = StringField('Ім\'я користувача', validators=[DataRequired()])
    password = PasswordField('Пароль', validators=[DataRequired()])
    remember_me = BooleanField('Запам\'ятати мене')
    submit = SubmitField('Увійти')

class RegistrationForm(FlaskForm):
    """Форма для реєстрації."""
    username = StringField('Ім\'я користувача', validators=[DataRequired()])
    password = PasswordField('Пароль', validators=[DataRequired()])
    password2 = PasswordField(
        'Повторіть пароль', validators=[DataRequired(), EqualTo('password', message='Паролі мають співпадати!')])
    submit = SubmitField('Зареєструватися')

    def validate_username(self, username):
        """Перевірка, чи ім'я користувача вже зайняте."""
        user = User.query.filter_by(username=username.data).first()
        if user is not None:
            raise ValidationError('Це ім\'я користувача вже зайняте.')

    # === НОВИЙ МЕТОД ДЛЯ ВАЛІДАЦІЇ ПАРОЛЯ ===
    def validate_password(self, password):
        """
        Перевірка, чи пароль містить лише ASCII (англ. літери, цифри, символи)
        """
        if not password.data.isascii():
            raise ValidationError('Пароль може містити лише англійські літери, цифри та символи.')
        
        # (Можна додати й інші перевірки, наприклад, мінімальну довжину)
        # if len(password.data) < 8:
        #    raise ValidationError('Пароль має бути щонайменше 8 символів.')