# gunicorn_starter.py
import eventlet
eventlet.monkey_patch()

# Автоматична міграція при старті
import os
from flask import Flask
from flask_migrate import upgrade

# Створюємо тимчасовий app для міграції
def run_migrations():
    try:
        print("=== Starting database migration ===")
        from app import create_app, db
        app = create_app()
        with app.app_context():
            upgrade()
        print("=== Migration completed successfully ===")
    except Exception as e:
        print(f"=== Migration error: {e} ===")

run_migrations()

from app import create_app, socketio
app = create_app()