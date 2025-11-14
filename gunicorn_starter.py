# gunicorn_starter.py
# Цей файл - ТІЛЬКИ для Gunicorn на Render.
# Він запускає "мавпячий-патч" ДО того, як імпортувати додаток.

import eventlet
eventlet.monkey_patch()

from app import create_app, socketio

app = create_app()